import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  PauseCircle,
  PlayCircle,
  Printer,
  RefreshCw,
  RotateCcw,
  Terminal,
  Trash2,
  Wifi,
  XCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  PrintJobRecord,
  applyJobCompletionToState,
  buildPrintableHtmlForStationJob,
  executeStationPrintJob,
  getSavedPrintStationMeta,
  isPrintStationAutoModeEnabled,
  mergeClaimedPrintJobs,
  playPrintStationNotificationChime,
  rpcCancelPrintJob,
  rpcClaimPrintJobs,
  rpcCompletePrintJob,
  rpcListStationPrintJobs,
  rpcPurgePrintJobs,
  rpcRegisterPrintStation,
  setPrintStationAutoModeEnabled,
  setSavedPrintStationConfig,
} from '../../services/printStationService';
import {
  DesktopPrinterInfo,
  DesktopZplSettings,
  DEFAULT_DESKTOP_ZPL_SETTINGS,
  getDesktopPrintSettings,
  getDesktopSystemSettings,
  getDesktopZplSettings,
  isDesktopApp,
  listDesktopPrinters,
  openDesktopSecondaryWindow,
  printDesktopZplRaw,
  setDesktopPrintSettings,
  setDesktopSystemSettings,
  setDesktopZplSettings,
  testDesktopZplPrinter,
  updateDesktopTrayStatus,
} from '../../services/desktopBridge';
import {
  ZplDpi,
  ZplFormatMm,
  generateOrderReadyZplLabel,
  generateProductZplLabel,
  validateZplPrinterAddress,
} from '../../services/zplLabel';

export const DesktopPrintStationPage: React.FC = () => {
  const { products, orders, depots, canViewPrices } = useApp();

  const savedMeta = getSavedPrintStationMeta();
  const [stationId, setStationId] = useState<string | null>(savedMeta.id);
  const [stationName, setStationName] = useState(savedMeta.name || 'Poste Magasin Principal');
  const [stationDepot, setStationDepot] = useState(savedMeta.depot || 'Dépôt Principal');
  const [autoMode, setAutoMode] = useState<boolean>(() => isPrintStationAutoModeEnabled());
  const [queuePaused, setQueuePaused] = useState(false);

  const [queue, setQueue] = useState<PrintJobRecord[]>([]);
  const [history, setHistory] = useState<PrintJobRecord[]>([]);
  const [selectedJob, setSelectedJob] = useState<PrintJobRecord | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const [printers, setPrinters] = useState<DesktopPrinterInfo[]>([]);
  const [selectedPrinterName, setSelectedPrinterName] = useState('');
  const [silentPrint, setSilentPrint] = useState(true);
  const [zplConfig, setZplConfig] = useState<DesktopZplSettings>(DEFAULT_DESKTOP_ZPL_SETTINGS);
  const [zplTestMessage, setZplTestMessage] = useState<string | null>(null);

  const desktopMode = isDesktopApp();

  useEffect(() => {
    if (!desktopMode) return;
    listDesktopPrinters().then(setPrinters);
    getDesktopPrintSettings().then((s) => {
      setSelectedPrinterName(s.printerName);
      setSilentPrint(s.silent);
    });
    getDesktopZplSettings().then(setZplConfig);
    getDesktopSystemSettings().then((sys) => setQueuePaused(sys.printQueuePaused));
  }, [desktopMode]);

  const registerStation = useCallback(async () => {
    if (!stationName.trim()) return;
    const res = await rpcRegisterPrintStation(stationName.trim(), stationDepot || null);
    if (res.stationId) {
      setStationId(res.stationId);
      setSavedPrintStationConfig(res.stationId, stationName.trim(), stationDepot || null);
      setStatusBanner(`Poste "${stationName.trim()}" actif et enregistré.`);
    } else if (res.error) {
      setStatusBanner(res.error);
    }
  }, [stationName, stationDepot]);

  const executeJob = useCallback(
    async (job: PrintJobRecord) => {
      if (desktopMode && zplConfig.enabled) {
        let zplPayload = '';
        if (job.kind === 'order_label') {
          zplPayload = generateOrderReadyZplLabel(
            {
              order_number: String(job.payload.order_number || ''),
              site_number: String(job.payload.site_number || ''),
              site_name: String(job.payload.site_name || ''),
              requester_name: String(job.payload.requester_name || ''),
              pickup_zone: String(job.payload.pickup_zone || 'Zone Retrait'),
              depot_name: String(job.payload.depot_name || ''),
            },
            {
              format: zplConfig.format,
              dpi: zplConfig.dpi,
              copies: job.copies,
              offsetXMm: zplConfig.offsetXMm,
              offsetYMm: zplConfig.offsetYMm,
              speed: zplConfig.speed,
              darkness: zplConfig.darkness,
            }
          );
        } else {
          const prod = products.find(
            (p) =>
              p.id === job.payload.product_id ||
              p.reference.toLowerCase() === String(job.payload.product_ref || '').toLowerCase()
          );
          if (prod) {
            zplPayload = generateProductZplLabel(prod, {
              format: zplConfig.format,
              dpi: zplConfig.dpi,
              copies: job.copies,
              offsetXMm: zplConfig.offsetXMm,
              offsetYMm: zplConfig.offsetYMm,
              speed: zplConfig.speed,
              darkness: zplConfig.darkness,
            });
          }
        }

        if (zplPayload) {
          const zplRes = await printDesktopZplRaw({
            zpl: zplPayload,
            transport: zplConfig.transport,
            host: zplConfig.host,
            port: zplConfig.port,
            rawPrinterName: zplConfig.rawPrinterName,
          });
          await rpcCompletePrintJob(job.id, zplRes.ok, zplRes.errorMessage || null);
          const next = applyJobCompletionToState(
            queue,
            history,
            job.id,
            zplRes.ok,
            zplRes.errorMessage
          );
          setQueue(next.queue);
          setHistory(next.history);
          return;
        }
      }

      const res = await executeStationPrintJob(job, products, orders, {
        canViewPrices,
        printerName: selectedPrinterName,
        silent: silentPrint,
      });
      await rpcCompletePrintJob(job.id, res.ok, res.error || null);
      const next = applyJobCompletionToState(queue, history, job.id, res.ok, res.error);
      setQueue(next.queue);
      setHistory(next.history);
    },
    [
      desktopMode,
      zplConfig,
      products,
      orders,
      canViewPrices,
      selectedPrinterName,
      silentPrint,
      queue,
      history,
    ]
  );

  // Leader lock via Web Locks API (Lot 4.5) so multiple desktop windows don't claim the same jobs simultaneously
  const pollStationJobs = useCallback(async () => {
    if (!stationId || queuePaused) return;

    const runClaim = async () => {
      await rpcRegisterPrintStation(stationName.trim() || 'Poste Bureau', stationDepot || null);
      const claimed = await rpcClaimPrintJobs(stationId);
      if (claimed.jobs.length > 0) {
        playPrintStationNotificationChime();
        setQueue((prev) => {
          const merged = mergeClaimedPrintJobs(prev, claimed.jobs);
          if (!selectedJob && merged.length > 0) {
            setSelectedJob(merged[0]);
          }
          return merged;
        });
        if (autoMode) {
          for (const j of claimed.jobs) {
            await executeJob(j);
          }
        }
      }
      const hist = await rpcListStationPrintJobs(stationId, 20);
      if (hist.jobs.length > 0) {
        setHistory(hist.jobs.filter((j) => j.status !== 'PENDING' && j.status !== 'PRINTING'));
      }
    };

    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      await navigator.locks.request(
        `tot-print-station-leader-${stationId}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) return;
          await runClaim();
        }
      );
    } else {
      await runClaim();
    }
  }, [stationId, queuePaused, stationName, stationDepot, selectedJob, autoMode, executeJob]);

  useEffect(() => {
    if (!stationId) return;
    pollStationJobs();
    const timer = setInterval(pollStationJobs, 10_000);
    return () => clearInterval(timer);
  }, [stationId, pollStationJobs]);

  useEffect(() => {
    if (desktopMode) {
      updateDesktopTrayStatus({
        pendingJobsCount: queue.length,
        paused: queuePaused,
      });
    }
  }, [desktopMode, queue.length, queuePaused]);

  useEffect(() => {
    let cancelled = false;
    async function renderPreview() {
      if (!selectedJob) {
        setPreviewHtml('');
        return;
      }
      const built = await buildPrintableHtmlForStationJob(
        selectedJob,
        products,
        orders,
        { canViewPrices }
      );
      if (!cancelled) {
        setPreviewHtml(built.html || '');
      }
    }
    renderPreview();
    return () => {
      cancelled = true;
    };
  }, [selectedJob, products, orders, canViewPrices]);

  const handleTestZpl = async () => {
    setZplTestMessage('Test en cours...');
    if (zplConfig.transport === 'tcp') {
      const addrCheck = validateZplPrinterAddress(zplConfig.host, zplConfig.port);
      if (!addrCheck.valid) {
        setZplTestMessage(addrCheck.error || 'Adresse invalide');
        return;
      }
      const res = await testDesktopZplPrinter({
        host: zplConfig.host,
        port: zplConfig.port,
      });
      if (!res.ok) {
        setZplTestMessage(res.errorMessage || 'Connexion refusée');
        return;
      }
    }
    const sampleZpl = generateOrderReadyZplLabel(
      {
        order_number: 'TEST-ZEBRA-01',
        site_number: 'CH-TEST',
        requester_name: 'Atelier TOT Stock',
        pickup_zone: 'Comptoir A',
      },
      {
        format: zplConfig.format,
        dpi: zplConfig.dpi,
        copies: 1,
        offsetXMm: zplConfig.offsetXMm,
        offsetYMm: zplConfig.offsetYMm,
      }
    );
    const sendRes = await printDesktopZplRaw({
      zpl: sampleZpl,
      transport: zplConfig.transport,
      host: zplConfig.host,
      port: zplConfig.port,
      rawPrinterName: zplConfig.rawPrinterName,
    });
    setZplTestMessage(
      sendRes.ok
        ? 'Étiquette de test ZPL envoyée avec succès !'
        : sendRes.errorMessage || "Échec d'envoi ZPL"
    );
  };

  return (
    <div className="grid grid-cols-12 h-full min-h-0 bg-slate-50 dark:bg-slate-950 divide-x divide-slate-200 dark:divide-slate-800">
      <div className="col-span-7 flex flex-col min-h-0 p-5 gap-4 overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Printer className="w-5 h-5 text-orange-600" />
              Poste d'impression d'étiquettes
            </h1>
            <p className="text-xs text-slate-500">
              Réception en temps réel des étiquettes envoyées depuis les terminaux mobiles et douchettes
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                const next = !queuePaused;
                setQueuePaused(next);
                if (desktopMode) {
                  await setDesktopSystemSettings({ printQueuePaused: next });
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${
                queuePaused
                  ? 'bg-amber-50 border-amber-300 text-amber-800'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
              }`}
            >
              {queuePaused ? (
                <>
                  <PlayCircle className="w-4 h-4 text-emerald-600" /> Reprendre les impressions
                </>
              ) : (
                <>
                  <PauseCircle className="w-4 h-4 text-amber-600" /> Mettre en pause
                </>
              )}
            </button>

            {desktopMode && (
              <button
                type="button"
                onClick={() => openDesktopSecondaryWindow('print_station')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100"
                title="Détacher le poste d'impression dans une seconde fenêtre"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Fenêtre dédiée
              </button>
            )}
          </div>
        </div>

        {statusBanner && (
          <div className="p-3 rounded-xl bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800 text-xs font-bold text-orange-800 dark:text-orange-200">
            {statusBanner}
          </div>
        )}

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
          <div className="grid grid-cols-12 gap-3 items-end">
            <div className="col-span-5">
              <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                Nom du poste d'impression
              </label>
              <input
                type="text"
                value={stationName}
                onChange={(e) => setStationName(e.target.value)}
                placeholder="Ex: Imprimante Comptoir A"
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
            <div className="col-span-4">
              <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                Dépôt rattaché
              </label>
              <select
                value={stationDepot}
                onChange={(e) => setStationDepot(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              >
                <option value="Dépôt Principal">Dépôt Principal</option>
                {depots.map((d) => (
                  <option key={String(d.id)} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-3">
              <button
                type="button"
                onClick={registerStation}
                className="w-full py-1.5 px-3 rounded-lg font-bold bg-orange-600 hover:bg-orange-700 text-white"
              >
                {stationId ? 'Mettre à jour poste' : 'Activer ce poste'}
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoMode}
                onChange={(e) => {
                  const val = e.target.checked;
                  setAutoMode(val);
                  setPrintStationAutoModeEnabled(val);
                }}
                className="rounded text-orange-600"
              />
              <span className="font-bold text-slate-700 dark:text-slate-200">
                Imprimer automatiquement dès réception
              </span>
            </label>

            {desktopMode && (
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Imprimante système :</span>
                <select
                  value={selectedPrinterName}
                  onChange={async (e) => {
                    const name = e.target.value;
                    setSelectedPrinterName(name);
                    await setDesktopPrintSettings({ printerName: name, silent: silentPrint });
                  }}
                  className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
                >
                  <option value="">Imprimante système par défaut</option>
                  {printers.map((pr) => (
                    <option key={pr.name} value={pr.name}>
                      {pr.displayName || pr.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-black text-slate-900 dark:text-white">
              <Terminal className="w-4 h-4 text-orange-600" />
              Imprimante thermique d'étiquettes Zebra (ZPL II direct)
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={zplConfig.enabled}
                onChange={async (e) => {
                  const next = await setDesktopZplSettings({ enabled: e.target.checked });
                  setZplConfig(next);
                }}
                className="rounded text-orange-600"
              />
              <span className="font-bold">Activer ZPL direct</span>
            </label>
          </div>

          {zplConfig.enabled && (
            <div className="grid grid-cols-12 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="col-span-4">
                <label className="block text-[11px] font-bold text-slate-500 mb-1">
                  Mode de connexion
                </label>
                <select
                  value={zplConfig.transport}
                  onChange={async (e) => {
                    const next = await setDesktopZplSettings({
                      transport: e.target.value as 'tcp' | 'raw_queue',
                    });
                    setZplConfig(next);
                  }}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="tcp">Réseau TCP/IP (JetDirect port 9100)</option>
                  <option value="raw_queue">File système brute (USB / CUPS raw)</option>
                </select>
              </div>

              {zplConfig.transport === 'tcp' ? (
                <>
                  <div className="col-span-5">
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">
                      Hôte / IP locale (RFC 1918)
                    </label>
                    <input
                      type="text"
                      value={zplConfig.host}
                      onChange={async (e) => {
                        const next = await setDesktopZplSettings({ host: e.target.value });
                        setZplConfig(next);
                      }}
                      placeholder="192.168.1.50"
                      className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 font-mono"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">
                      Port TCP
                    </label>
                    <select
                      value={zplConfig.port}
                      onChange={async (e) => {
                        const next = await setDesktopZplSettings({ port: Number(e.target.value) });
                        setZplConfig(next);
                      }}
                      className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 font-mono"
                    >
                      <option value={9100}>9100</option>
                      <option value={9101}>9101</option>
                      <option value={9102}>9102</option>
                    </select>
                  </div>
                </>
              ) : (
                <div className="col-span-8">
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">
                    File d'imprimante USB/CUPS
                  </label>
                  <select
                    value={zplConfig.rawPrinterName}
                    onChange={async (e) => {
                      const next = await setDesktopZplSettings({ rawPrinterName: e.target.value });
                      setZplConfig(next);
                    }}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700"
                  >
                    <option value="">-- Choisir l'imprimante Zebra --</option>
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.displayName || p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="col-span-3">
                <label className="block text-[11px] font-bold text-slate-500 mb-1">
                  Format rouleau
                </label>
                <select
                  value={zplConfig.format}
                  onChange={async (e) => {
                    const next = await setDesktopZplSettings({
                      format: e.target.value as ZplFormatMm,
                    });
                    setZplConfig(next);
                  }}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700"
                >
                  <option value="50x30">50 × 30 mm</option>
                  <option value="70x37">70 × 37 mm</option>
                  <option value="90x50">90 × 50 mm (Bac)</option>
                </select>
              </div>

              <div className="col-span-3">
                <label className="block text-[11px] font-bold text-slate-500 mb-1">
                  Résolution tête
                </label>
                <select
                  value={zplConfig.dpi}
                  onChange={async (e) => {
                    const next = await setDesktopZplSettings({
                      dpi: Number(e.target.value) as ZplDpi,
                    });
                    setZplConfig(next);
                  }}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 font-mono"
                >
                  <option value={203}>203 dpi (8 dpmm)</option>
                  <option value={300}>300 dpi (12 dpmm)</option>
                </select>
              </div>

              <div className="col-span-3">
                <label className="block text-[11px] font-bold text-slate-500 mb-1">
                  Décalage X / Y (mm)
                </label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    min={-10}
                    max={10}
                    value={zplConfig.offsetXMm}
                    onChange={async (e) => {
                      const next = await setDesktopZplSettings({
                        offsetXMm: Number(e.target.value) || 0,
                      });
                      setZplConfig(next);
                    }}
                    className="w-1/2 px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 font-mono"
                  />
                  <input
                    type="number"
                    min={-10}
                    max={10}
                    value={zplConfig.offsetYMm}
                    onChange={async (e) => {
                      const next = await setDesktopZplSettings({
                        offsetYMm: Number(e.target.value) || 0,
                      });
                      setZplConfig(next);
                    }}
                    className="w-1/2 px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 font-mono"
                  />
                </div>
              </div>

              <div className="col-span-3 flex items-end">
                <button
                  type="button"
                  onClick={handleTestZpl}
                  className="w-full py-1.5 px-3 rounded-lg font-bold bg-slate-900 text-white hover:bg-slate-800 flex items-center justify-center gap-1.5"
                >
                  <Wifi className="w-3.5 h-3.5 text-orange-400" />
                  Étiquette de test
                </button>
              </div>

              {zplTestMessage && (
                <div className="col-span-12 text-[11px] font-bold text-orange-600">
                  {zplTestMessage}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
              File d'attente ({queue.length}) & Historique récent ({history.length})
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={pollStationJobs}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Actualiser
              </button>
              <button
                type="button"
                onClick={() => rpcPurgePrintJobs()}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold text-slate-500 hover:text-rose-600"
              >
                <Trash2 className="w-3.5 h-3.5" /> Purger anciens
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] font-bold uppercase text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2 px-3">Heure</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Cible</th>
                  <th className="py-2 px-3">Format / Copies</th>
                  <th className="py-2 px-3">Statut</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {[...queue, ...history].length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">
                      Aucun travail d'impression en attente ou dans l'historique.
                    </td>
                  </tr>
                ) : (
                  [...queue, ...history].map((job) => {
                    const isSelected = selectedJob?.id === job.id;
                    const targetLabel =
                      job.kind === 'order_label'
                        ? `Cmd ${job.payload.order_number || ''}`
                        : `Réf ${job.payload.product_ref || job.payload.product_id || ''}`;
                    return (
                      <tr
                        key={job.id}
                        onClick={() => setSelectedJob(job)}
                        className={`cursor-pointer ${
                          isSelected
                            ? 'bg-orange-50/80 dark:bg-orange-950/30'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">
                          {new Date(job.created_at).toLocaleTimeString('fr-FR')}
                        </td>
                        <td className="py-2.5 px-3 font-bold">
                          {job.kind === 'order_label' ? 'Commande prête' : 'Article'}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-900 dark:text-white">
                          {targetLabel}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px]">
                          {job.format} × {job.copies}
                        </td>
                        <td className="py-2.5 px-3">
                          {job.status === 'DONE' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-bold">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Imprimé
                            </span>
                          ) : job.status === 'FAILED' ? (
                            <span className="inline-flex items-center gap-1 text-rose-600 font-bold">
                              <XCircle className="w-3.5 h-3.5" /> Échec
                            </span>
                          ) : (
                            <span className="text-orange-600 font-bold">{job.status}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right space-x-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              executeJob(job);
                            }}
                            className="px-2.5 py-1 rounded bg-orange-600 text-white font-bold hover:bg-orange-700"
                          >
                            {job.status === 'DONE' ? 'Réimprimer' : 'Imprimer'}
                          </button>
                          {(job.status === 'PENDING' || job.status === 'PRINTING') && (
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                await rpcCancelPrintJob(job.id);
                                setQueue((q) => q.filter((x) => x.id !== job.id));
                              }}
                              className="px-2 py-1 rounded border border-slate-200 text-slate-500 hover:text-rose-600"
                            >
                              Annuler
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="col-span-5 flex flex-col min-h-0 bg-slate-100 dark:bg-slate-950 p-5 gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Aperçu de l'étiquette sélectionnée
          </h2>
          {selectedJob && (
            <button
              type="button"
              onClick={() => executeJob(selectedJob)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-600 text-white hover:bg-orange-700"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Lancer l'impression
            </button>
          )}
        </div>

        <div className="flex-1 rounded-2xl bg-white text-slate-900 border border-slate-200 shadow-inner overflow-auto p-6">
          {!selectedJob ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-400 text-center">
              Cliquez sur un travail dans le tableau à gauche pour prévisualiser son rendu.
            </div>
          ) : (
            <iframe
              title="Aperçu étiquette"
              srcDoc={previewHtml}
              sandbox="allow-same-origin"
              className="w-full h-full border-0 min-h-[420px]"
            />
          )}
        </div>
      </div>
    </div>
  );
};
