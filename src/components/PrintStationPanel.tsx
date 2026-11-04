import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Printer,
  X,
  Radio,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Volume2,
  VolumeX,
  Bell,
  Play,
  RotateCcw,
  Trash2,
  Building2,
  Package,
  FileText,
  Clock,
  Info,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getClientSupabase } from '../services/clientSupabase';
import {
  DesktopPrinterInfo,
  DesktopUpdateStatus,
  getDesktopPrintSettings,
  getDesktopUpdateStatus,
  isDesktopApp,
  listDesktopPrinters,
  quitAndInstallDesktopUpdate,
  setDesktopPrintSettings,
  subscribeDesktopUpdateStatus,
} from '../services/desktopBridge';
import {
  PrintJobRecord,
  applyJobCompletionToState,
  executeStationPrintJob,
  getSavedPrintStationMeta,
  isPrintStationAutoModeEnabled,
  isPrintStationBlinkEnabled,
  isPrintStationSoundEnabled,
  mergeClaimedPrintJobs,
  playPrintStationNotificationChime,
  retryFailedJobInState,
  rpcCancelPrintJob,
  rpcClaimPrintJobs,
  rpcCompletePrintJob,
  rpcListStationPrintJobs,
  rpcPurgePrintJobs,
  rpcRegisterPrintStation,
  setPrintStationAutoModeEnabled,
  setPrintStationBlinkEnabled,
  setPrintStationSoundEnabled,
  setSavedPrintStationConfig,
} from '../services/printStationService';
import { tr } from '../i18n/dutchTranslator';

export const PrintStationPanel: React.FC = () => {
  const {
    printStationModalOpen,
    setPrintStationModalOpen,
    currentUser,
    depots,
    products,
    orders: materialOrders,
    userHasPermission,
    language,
    t,
  } = useApp();

  const canUsePrintStation = userHasPermission('perm_menu_print_labels');
  const canViewPrices = userHasPermission('perm_prod_view_price');

  const savedMeta = useMemo(() => getSavedPrintStationMeta(), [printStationModalOpen]);

  const allowedDepotsList = useMemo(() => {
    if (!currentUser) return [];
    const allowed = currentUser.allowed_depots || [];
    if (
      currentUser.role_id === 0 ||
      currentUser.role_id === 1 ||
      allowed.includes('*') ||
      allowed.includes('ALL')
    ) {
      return depots.filter((d) => d.is_active !== false);
    }
    return depots.filter(
      (d) =>
        d.is_active !== false &&
        allowed.some((a) => a.trim().toLowerCase() === d.name.trim().toLowerCase())
    );
  }, [currentUser, depots]);

  const [stationId, setStationId] = useState<string | null>(savedMeta.id);
  const [stationName, setStationName] = useState<string>(
    savedMeta.name || `Poste ${currentUser?.name || 'Magasin'}`
  );
  const [stationDepot, setStationDepot] = useState<string>(
    savedMeta.depot || (allowedDepotsList.length === 1 ? allowedDepotsList[0].name : '')
  );

  const [autoMode, setAutoMode] = useState<boolean>(() => isPrintStationAutoModeEnabled());
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => isPrintStationSoundEnabled());
  const [blinkEnabled, setBlinkEnabled] = useState<boolean>(() => isPrintStationBlinkEnabled());

  const isDesktop = isDesktopApp();
  const [desktopPrinters, setDesktopPrinters] = useState<DesktopPrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>('');
  const [silentPrint, setSilentPrint] = useState<boolean>(true);
  const [loadingPrinters, setLoadingPrinters] = useState<boolean>(false);
  const [desktopUpdateStatus, setDesktopUpdateStatus] = useState<DesktopUpdateStatus>({
    enabled: false,
    state: 'idle',
    version: null,
    error: null,
  });

  const [waitingQueue, setWaitingQueue] = useState<PrintJobRecord[]>([]);
  const [historyJobs, setHistoryJobs] = useState<PrintJobRecord[]>([]);
  const historyJobsRef = useRef<PrintJobRecord[]>(historyJobs);
  useEffect(() => {
    historyJobsRef.current = historyJobs;
  }, [historyJobs]);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [activePrintingJobId, setActivePrintingJobId] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'ok' | 'err' | 'info';
    text: string;
  } | null>(null);
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<string | null>(null);

  const knownJobIdsRef = useRef<Set<string>>(new Set());
  const blinkIntervalRef = useRef<number | null>(null);
  const originalDocTitleRef = useRef<string>(
    typeof document !== 'undefined' ? document.title : 'TOT Stock'
  );
  const autoPrintLockRef = useRef<boolean>(false);

  // Stop tab title blinking when user focuses window or queue empties
  const stopTitleBlink = useCallback(() => {
    if (blinkIntervalRef.current !== null && typeof window !== 'undefined') {
      window.clearInterval(blinkIntervalRef.current);
      blinkIntervalRef.current = null;
    }
    if (typeof document !== 'undefined') {
      document.title = originalDocTitleRef.current;
    }
  }, []);

  const triggerTitleBlink = useCallback(
    (pendingCount: number) => {
      if (!blinkEnabled || typeof document === 'undefined' || typeof window === 'undefined') return;
      stopTitleBlink();
      let toggle = false;
      blinkIntervalRef.current = window.setInterval(() => {
        toggle = !toggle;
        document.title = toggle
          ? `🖨️ (${pendingCount}) ${t('print_station_title')} — TOT Stock`
          : originalDocTitleRef.current;
      }, 1000);
    },
    [blinkEnabled, stopTitleBlink, t]
  );

  useEffect(() => {
    if (waitingQueue.length === 0) {
      stopTitleBlink();
    }
  }, [waitingQueue.length, stopTitleBlink]);

  useEffect(() => {
    return () => {
      stopTitleBlink();
    };
  }, [stopTitleBlink]);

  const refreshDesktopPrinterConfig = useCallback(async () => {
    if (!isDesktop) return;
    setLoadingPrinters(true);
    try {
      const [printers, settings] = await Promise.all([
        listDesktopPrinters(),
        getDesktopPrintSettings(),
      ]);
      setDesktopPrinters(printers);
      setSilentPrint(settings.silent);
      const chosenPrinter =
        settings.printerName && printers.some((p) => p.name === settings.printerName)
          ? settings.printerName
          : printers.find((p) => p.isDefault)?.name || printers[0]?.name || settings.printerName || '';
      setSelectedPrinter(chosenPrinter);
      if (chosenPrinter && chosenPrinter !== settings.printerName) {
        await setDesktopPrintSettings({ printerName: chosenPrinter, silent: settings.silent });
      }
    } finally {
      setLoadingPrinters(false);
    }
  }, [isDesktop]);

  useEffect(() => {
    if (!printStationModalOpen || !isDesktop) return;
    refreshDesktopPrinterConfig();
    getDesktopUpdateStatus().then(setDesktopUpdateStatus);
    const unsub = subscribeDesktopUpdateStatus((st) => {
      setDesktopUpdateStatus(st);
    });
    return () => {
      unsub();
    };
  }, [printStationModalOpen, isDesktop, refreshDesktopPrinterConfig]);

  // Execute printing for a single job
  const executePrintJob = useCallback(
    async (job: PrintJobRecord) => {
      setActivePrintingJobId(job.id);
      try {
        const printRes = await executeStationPrintJob(job, products, materialOrders, {
          canViewPrices,
          locale: tr(language, 'fr-FR', 'en-US', 'nl-NL'),
          printerName: selectedPrinter,
          silent: silentPrint,
        });

        if (printRes.ok) {
          await rpcCompletePrintJob(job.id, true, null);
          setWaitingQueue((prevQ) => {
            const next = applyJobCompletionToState(prevQ, historyJobsRef.current, job.id, true, null);
            setHistoryJobs(next.history);
            return next.queue;
          });
          setStatusBanner({
            type: 'ok',
            text: `${printRes.title} — ${t('print_station_status_done')}`,
          });
        } else {
          const errMsg = printRes.error || 'Impression annulée ou en échec';
          await rpcCompletePrintJob(job.id, false, errMsg);
          setWaitingQueue((prevQ) => {
            const next = applyJobCompletionToState(prevQ, historyJobsRef.current, job.id, false, errMsg);
            setHistoryJobs(next.history);
            return next.queue;
          });
          setStatusBanner({ type: 'err', text: errMsg });
        }
      } finally {
        setActivePrintingJobId(null);
      }
    },
    [products, materialOrders, canViewPrices, language, t, selectedPrinter, silentPrint]
  );

  // Claim new PENDING jobs and refresh station log
  const pollAndClaimJobs = useCallback(
    async (activeStationId: string) => {
      if (!activeStationId) return;
      setIsPolling(true);
      try {
        const [claimRes, logRes] = await Promise.all([
          rpcClaimPrintJobs(activeStationId),
          rpcListStationPrintJobs(activeStationId, 20),
        ]);

        if (!claimRes.error) {
          setLastHeartbeatAt(new Date().toISOString());
        }

        const newlyClaimed = claimRes.jobs || [];
        const allRecent = logRes.jobs || [];

        // Keep any existing PRINTING jobs from the server log so a page reload doesn't lose them
        const serverPrintingJobs = allRecent.filter((j) => j.status === 'PRINTING');
        const combinedIncoming = [...serverPrintingJobs, ...newlyClaimed];

        if (combinedIncoming.length > 0) {
          let hasBrandNewJob = false;
          for (const j of combinedIncoming) {
            if (!knownJobIdsRef.current.has(j.id)) {
              knownJobIdsRef.current.add(j.id);
              hasBrandNewJob = true;
            }
          }

          setWaitingQueue((prev) => {
            const merged = mergeClaimedPrintJobs(prev, combinedIncoming);
            if (hasBrandNewJob) {
              playPrintStationNotificationChime();
              triggerTitleBlink(merged.length);
            }
            return JSON.stringify(prev) === JSON.stringify(merged) ? prev : merged;
          });
        }

        if (allRecent.length > 0) {
          const nextHist = allRecent.slice(0, 20);
          setHistoryJobs((prev) =>
            JSON.stringify(prev) === JSON.stringify(nextHist) ? prev : nextHist
          );
        }
      } finally {
        setIsPolling(false);
      }
    },
    [triggerTitleBlink]
  );

  // Auto-print queue processor when autoMode is enabled
  useEffect(() => {
    if (!printStationModalOpen || !autoMode || waitingQueue.length === 0) return;
    if (activePrintingJobId || autoPrintLockRef.current) return;

    const nextJob = waitingQueue[0];
    if (!nextJob) return;

    autoPrintLockRef.current = true;
    executePrintJob(nextJob).finally(() => {
      autoPrintLockRef.current = false;
    });
  }, [printStationModalOpen, autoMode, waitingQueue, activePrintingJobId, executePrintJob]);

  // Realtime subscription + 10s fallback polling + visibilitychange/focus wakeup
  useEffect(() => {
    if (!printStationModalOpen || !stationId || !canUsePrintStation) return;

    // Initial claim & refresh
    pollAndClaimJobs(stationId);

    // 10-second fallback polling
    const intervalId = window.setInterval(() => {
      pollAndClaimJobs(stationId);
    }, 10000);

    // Wake up on focus / visibilitychange
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        stopTitleBlink();
        pollAndClaimJobs(stationId);
      }
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    // Supabase Realtime subscription (broadcast + postgres_changes)
    const client = getClientSupabase();
    let channel: ReturnType<NonNullable<typeof client>['channel']> | null = null;
    if (client) {
      try {
        channel = client
          .channel(`tot-print-station-${stationId}`)
          .on('broadcast', { event: 'new_print_job' }, () => {
            pollAndClaimJobs(stationId);
          })
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'print_jobs',
              filter: `station_id=eq.${stationId}`,
            },
            () => {
              pollAndClaimJobs(stationId);
            }
          )
          .subscribe();
      } catch {
        // Fallback polling every 10s remains active
      }
    }

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      if (client && channel) {
        client.removeChannel(channel);
      }
    };
  }, [printStationModalOpen, stationId, canUsePrintStation, pollAndClaimJobs, stopTitleBlink]);

  if (!printStationModalOpen) return null;

  const handleRegisterStation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stationName.trim()) return;
    setIsRegistering(true);
    setStatusBanner(null);
    try {
      const res = await rpcRegisterPrintStation(stationName.trim(), stationDepot || null);
      if (res.error || !res.stationId) {
        setStatusBanner({
          type: 'err',
          text: res.error || "Erreur d'enregistrement du poste",
        });
        return;
      }
      setStationId(res.stationId);
      setSavedPrintStationConfig(res.stationId, stationName.trim(), stationDepot || null);
      setStatusBanner({
        type: 'ok',
        text: `${t('print_station_online_badge')} — ${stationName.trim()}`,
      });
      await pollAndClaimJobs(res.stationId);
    } finally {
      setIsRegistering(false);
    }
  };

  const handlePrintAll = async () => {
    for (const job of [...waitingQueue]) {
      await executePrintJob(job);
    }
  };

  const handleMarkFailedManual = async (job: PrintJobRecord) => {
    const errMsg = tr(
      language,
      'Marqué en échec manuellement sur le poste',
      'Manually marked as failed on station',
      'Handmatig als mislukt gemarkeerd op station'
    );
    await rpcCompletePrintJob(job.id, false, errMsg);
    setWaitingQueue((prevQ) => {
      const next = applyJobCompletionToState(prevQ, historyJobs, job.id, false, errMsg);
      setHistoryJobs(next.history);
      return next.queue;
    });
  };

  const handleRetryFailedJob = async (jobId: string) => {
    const next = retryFailedJobInState(waitingQueue, historyJobs, jobId);
    setWaitingQueue(next.queue);
    setHistoryJobs(next.history);
    if (next.jobToPrint) {
      await executePrintJob(next.jobToPrint);
    }
  };

  const handleCancelPendingJob = async (jobId: string) => {
    const res = await rpcCancelPrintJob(jobId);
    if (!res.error) {
      setWaitingQueue((prev) => prev.filter((j) => j.id !== jobId));
      if (stationId) {
        await pollAndClaimJobs(stationId);
      }
    }
  };

  const handlePurgeOldJobs = async () => {
    const res = await rpcPurgePrintJobs();
    if (res.error) {
      setStatusBanner({ type: 'err', text: res.error });
    } else {
      setStatusBanner({
        type: 'info',
        text: tr(
          language,
          `${res.deletedCount} ancien(s) travail(aux) (> 7 jours) purgé(s).`,
          `${res.deletedCount} old job(s) (> 7 days) purged.`,
          `${res.deletedCount} oude ta(a)k(en) (> 7 dagen) gewist.`
        ),
      });
      if (stationId) {
        await pollAndClaimJobs(stationId);
      }
    }
  };

  const formatLabelBadge = (format: string) => {
    switch (format) {
      case 'avery_70x37':
        return t('scanner_print_format_avery_70x37');
      case 'avery_105x42':
        return t('scanner_print_format_avery_105x42');
      case 'thermal_50x30':
        return t('scanner_print_format_thermal_50x30');
      case 'bin_90x50':
        return t('scanner_print_format_bin_90x50');
      default:
        return format;
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setPrintStationModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/75 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-white dark:bg-slate-900 w-full max-w-4xl rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[94dvh] sm:max-h-[92vh]">
        {/* Header */}
        <div className="p-3.5 sm:p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-gradient-to-r from-indigo-500/10 via-orange-500/10 to-transparent gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-2xl bg-orange-500/15 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0">
              <Printer className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white truncate">
                  {t('print_station_title')}
                </h2>
                {stationId ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    {t('print_station_online_badge')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    {t('print_station_offline_badge')}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-orange-100 dark:bg-orange-950/80 text-orange-800 dark:text-orange-300">
                  {waitingQueue.length} {t('print_station_pending_count')}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                {t('print_station_subtitle')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {stationId && (
              <button
                type="button"
                onClick={() => pollAndClaimJobs(stationId)}
                disabled={isPolling}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition cursor-pointer"
                title="Actualiser"
              >
                <RefreshCw className={`w-4 h-4 ${isPolling ? 'animate-spin text-orange-500' : ''}`} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setPrintStationModalOpen(false)}
              className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 cursor-pointer"
              aria-label={t('common_close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Status Banner */}
        {statusBanner && (
          <div
            className={`mx-4 mt-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold flex items-center justify-between gap-2 border ${
              statusBanner.type === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                : statusBanner.type === 'err'
                ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                : 'bg-sky-50 dark:bg-sky-950/50 border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {statusBanner.type === 'ok' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : statusBanner.type === 'err' ? (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              ) : (
                <Info className="w-4 h-4 shrink-0" />
              )}
              <span className="truncate">{statusBanner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-[11px] underline opacity-75 hover:opacity-100 cursor-pointer shrink-0"
            >
              OK
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* LEFT: Station Configuration & Settings (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            <form
              onSubmit={handleRegisterStation}
              className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <Radio className="w-4 h-4 text-orange-500" />
                  Configuration du poste
                </span>
                {lastHeartbeatAt && (
                  <span className="text-[10px] text-slate-400">
                    Sync: {new Date(lastHeartbeatAt).toLocaleTimeString()}
                  </span>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('print_station_name_label')}
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={80}
                  value={stationName}
                  onChange={(e) => setStationName(e.target.value)}
                  placeholder={t('print_station_name_placeholder')}
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  {t('print_station_depot_label')}
                </label>
                <select
                  value={stationDepot}
                  onChange={(e) => setStationDepot(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white outline-none focus:border-orange-500"
                >
                  <option value="">{t('print_station_depot_all')}</option>
                  {allowedDepotsList.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={isRegistering || !stationName.trim()}
                className="w-full py-2.5 px-4 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-extrabold text-xs flex items-center justify-center gap-2 shadow-sm transition cursor-pointer disabled:opacity-50"
              >
                <Printer className="w-4 h-4" />
                <span>
                  {stationId ? t('print_station_update_btn') : t('print_station_register_btn')}
                </span>
              </button>
            </form>

            {/* Desktop Update Banner (when an update has been downloaded in background) */}
            {isDesktop && desktopUpdateStatus.state === 'downloaded' && (
              <div className="p-3.5 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 space-y-2 text-xs">
                <div className="font-extrabold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                  <RefreshCw className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span>
                    {tr(
                      language,
                      `Mise à jour bureau prête${desktopUpdateStatus.version ? ` (v${desktopUpdateStatus.version})` : ''}`,
                      `Desktop update ready${desktopUpdateStatus.version ? ` (v${desktopUpdateStatus.version})` : ''}`,
                      `Desktop-update klaar${desktopUpdateStatus.version ? ` (v${desktopUpdateStatus.version})` : ''}`
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => quitAndInstallDesktopUpdate()}
                  className="w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs transition cursor-pointer"
                >
                  {tr(
                    language,
                    'Redémarrer pour mettre à jour',
                    'Restart to update',
                    'Herstarten om bij te werken'
                  )}
                </button>
              </div>
            )}

            {/* Desktop Printer Selector & Silent Mode (only in Electron Desktop App) */}
            {isDesktop && (
              <div className="p-4 rounded-2xl bg-orange-50/70 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900/60 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold uppercase tracking-wider text-orange-800 dark:text-orange-300 flex items-center gap-1.5">
                    <Printer className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                    {tr(
                      language,
                      'Imprimante du poste (Version Bureau)',
                      'Station Printer (Desktop App)',
                      'Stationprinter (Desktopversie)'
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={refreshDesktopPrinterConfig}
                    disabled={loadingPrinters}
                    className="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300 hover:bg-orange-100 transition cursor-pointer"
                    title={tr(language, 'Actualiser les imprimantes', 'Refresh printers', 'Printers vernieuwen')}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingPrinters ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'Imprimante cible', 'Target printer', 'Doelprinter')}
                  </label>
                  <select
                    value={selectedPrinter}
                    onChange={async (e) => {
                      const nextPrinter = e.target.value;
                      setSelectedPrinter(nextPrinter);
                      await setDesktopPrintSettings({
                        printerName: nextPrinter,
                        silent: silentPrint,
                      });
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-orange-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white outline-none focus:border-orange-500"
                  >
                    {desktopPrinters.length === 0 ? (
                      <option value="">
                        {tr(
                          language,
                          'Aucune imprimante détectée',
                          'No printer detected',
                          'Geen printer gedetecteerd'
                        )}
                      </option>
                    ) : (
                      desktopPrinters.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.displayName || p.name}
                          {p.isDefault ? ' ★' : ''}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
                  <input
                    type="checkbox"
                    checked={silentPrint}
                    onChange={async (e) => {
                      const nextSilent = e.target.checked;
                      setSilentPrint(nextSilent);
                      await setDesktopPrintSettings({
                        printerName: selectedPrinter,
                        silent: nextSilent,
                      });
                    }}
                    className="mt-0.5 accent-orange-600 rounded"
                  />
                  <div>
                    <div className="font-extrabold text-slate-800 dark:text-slate-100">
                      {tr(
                        language,
                        'Impression silencieuse (sans boîte de dialogue)',
                        'Silent printing (without dialog)',
                        'Stil afdrukken (zonder dialoogvenster)'
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                      {tr(
                        language,
                        "Envoie directement l'étiquette au pilote de l'imprimante sélectionnée sans ouvrir de fenêtre de confirmation.",
                        'Sends the label directly to the selected printer driver without opening a confirmation dialog.',
                        'Stuurt het etiket rechtstreeks naar de geselecteerde printerdriver zonder bevestigingsvenster.'
                      )}
                    </p>
                  </div>
                </label>
              </div>
            )}

            {/* Mode & Notification Options */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoMode}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setAutoMode(v);
                    setPrintStationAutoModeEnabled(v);
                  }}
                  className="mt-0.5 accent-orange-600 rounded"
                />
                <div>
                  <div className="font-extrabold text-slate-800 dark:text-slate-100">
                    {isDesktop
                      ? tr(
                          language,
                          'Impression automatique à réception',
                          'Auto-print on arrival',
                          'Automatisch afdrukken bij ontvangst'
                        )
                      : t('print_station_auto_mode_label')}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    {isDesktop
                      ? tr(
                          language,
                          "Imprime dès l'arrivée d'une demande sur l'imprimante sélectionnée ci-dessus.",
                          'Prints immediately upon arrival on the printer selected above.',
                          'Drukt direct bij ontvangst af op de hierboven geselecteerde printer.'
                        )
                      : t('print_station_auto_mode_hint')}
                  </p>
                </div>
              </label>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={soundEnabled}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setSoundEnabled(v);
                      setPrintStationSoundEnabled(v);
                    }}
                    className="accent-orange-600 rounded"
                  />
                  {soundEnabled ? (
                    <Volume2 className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                  ) : (
                    <VolumeX className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  )}
                  <span className="font-bold text-[11px] text-slate-700 dark:text-slate-200">
                    {t('print_station_sound_label')}
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={blinkEnabled}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setBlinkEnabled(v);
                      setPrintStationBlinkEnabled(v);
                      if (!v) stopTitleBlink();
                    }}
                    className="accent-orange-600 rounded"
                  />
                  <Bell className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                  <span className="font-bold text-[11px] text-slate-700 dark:text-slate-200">
                    {t('print_station_blink_label')}
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* RIGHT: Active Queue & 20 Last Jobs Log (7 cols) */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            {/* Active Queue Box */}
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>Travaux à imprimer</span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 font-black">
                    {waitingQueue.length}
                  </span>
                </h3>
                {waitingQueue.length > 1 && (
                  <button
                    type="button"
                    disabled={Boolean(activePrintingJobId)}
                    onClick={handlePrintAll}
                    className="px-3 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-extrabold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>{t('print_station_print_all_btn')}</span>
                  </button>
                )}
              </div>

              {waitingQueue.length === 0 ? (
                <div className="py-8 px-4 text-center rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                  <Printer className="w-7 h-7 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                  <p>{t('print_station_queue_empty')}</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {waitingQueue.map((job) => {
                    const isOrder = job.kind === 'order_label';
                    const mainLabel = isOrder
                      ? `Commande ${job.payload?.order_number || ''}`
                      : `Article ${job.payload?.product_ref || job.payload?.product_id || ''}`;
                    const subLabel = isOrder
                      ? `${job.payload?.site_number || ''} ${job.payload?.pickup_zone ? `• Retrait: ${job.payload.pickup_zone}` : ''}`
                      : `Copies : ×${job.copies}`;

                    return (
                      <div
                        key={job.id}
                        className="py-2.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {isOrder ? (
                              <FileText className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                            ) : (
                              <Package className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                            )}
                            <span className="font-extrabold text-slate-900 dark:text-white truncate">
                              {mainLabel}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                              {formatLabelBadge(job.format)}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-orange-50 dark:bg-orange-950/60 text-[10px] font-extrabold text-orange-700 dark:text-orange-300">
                              ×{job.copies}
                            </span>
                          </div>
                          {subLabel && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                              {subLabel}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={activePrintingJobId === job.id}
                            onClick={() => executePrintJob(job)}
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>{t('print_station_print_one_btn')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMarkFailedManual(job)}
                            className="px-2.5 py-1.5 rounded-xl border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-bold text-[11px] cursor-pointer"
                            title="Marquer en échec / Annulé"
                          >
                            {t('print_station_status_failed')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* History Log (20 last jobs) */}
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>{t('print_station_history_title')}</span>
                </h3>
                <button
                  type="button"
                  onClick={handlePurgeOldJobs}
                  className="text-[11px] font-bold text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{t('print_station_purge_btn')}</span>
                </button>
              </div>

              {historyJobs.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-400">
                  {t('print_station_history_empty')}
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {historyJobs.map((job) => {
                    const isOrder = job.kind === 'order_label';
                    const title = isOrder
                      ? `${t('print_station_kind_order')} ${job.payload?.order_number || ''}`
                      : `${t('print_station_kind_product')} ${job.payload?.product_ref || job.payload?.product_id || ''}`;

                    return (
                      <div
                        key={job.id}
                        className="py-2 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-slate-800 dark:text-slate-200 truncate">
                              {title}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              ×{job.copies} • {formatLabelBadge(job.format)}
                            </span>
                          </div>
                          {job.error && (
                            <div className="text-[10px] text-rose-600 dark:text-rose-400 truncate">
                              {job.error}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {job.status === 'DONE' && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300">
                              {t('print_station_status_done')}
                            </span>
                          )}
                          {job.status === 'FAILED' && (
                            <>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300">
                                {t('print_station_status_failed')}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRetryFailedJob(job.id)}
                                className="px-2 py-1 rounded-lg bg-orange-100 dark:bg-orange-950/70 text-orange-700 dark:text-orange-300 font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                              >
                                <RotateCcw className="w-3 h-3" />
                                {t('print_station_retry_btn')}
                              </button>
                            </>
                          )}
                          {job.status === 'PENDING' && (
                            <>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300">
                                {t('print_station_status_pending')}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCancelPendingJob(job.id)}
                                className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold cursor-pointer"
                              >
                                {t('print_station_cancel_btn')}
                              </button>
                            </>
                          )}
                          {job.status === 'PRINTING' && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300">
                              {t('print_station_status_printing')}
                            </span>
                          )}
                          {job.status === 'CANCELLED' && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500">
                              {t('print_station_status_cancelled')}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
