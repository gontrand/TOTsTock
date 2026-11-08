import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Pause,
  Play,
  Printer,
  RefreshCw,
  RotateCcw,
  Settings2,
  Terminal,
  Trash2,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  PrintJobRecord,
  PrintStationRecord,
  buildPrintableHtmlForStationJob,
  executeStationPrintJob,
  getSavedPrintStationMeta,
  isPrintStationAutoModeEnabled,
  isPrintStationSoundEnabled,
  playPrintStationNotificationChime,
  rpcCancelPrintJob,
  rpcClaimPrintJobs,
  rpcCompletePrintJob,
  rpcListPrintStations,
  rpcListStationPrintJobs,
  rpcPurgePrintJobs,
  rpcRegisterPrintStation,
  setPrintStationAutoModeEnabled,
  setPrintStationSoundEnabled,
  setSavedPrintStationConfig,
} from '../../services/printStationService';
import {
  DEFAULT_DESKTOP_ZPL_SETTINGS,
  DesktopPrinterInfo,
  DesktopZplSettings,
  ZplTransportMode,
  getDesktopPrintSettings,
  getDesktopZplSettings,
  isDesktopApp,
  listDesktopPrinters,
  openDesktopSecondaryWindow,
  printDesktopZplRaw,
  setDesktopPrintSettings,
  setDesktopZplSettings,
} from '../../services/desktopBridge';
import { generateProductZplLabel } from '../../services/zplLabel';
import { tr } from '../../i18n/dutchTranslator';
import { SearchableSelect } from '../../components/SearchableSelect';

export const DesktopPrintStationPage: React.FC = () => {
  const { depots, products, orders, canViewPrices, language } = useApp();

  const locale = language === 'nl' ? 'nl-NL' : language === 'en' ? 'en-GB' : 'fr-FR';

  const initialMeta = getSavedPrintStationMeta();
  const [stationId, setStationId] = useState<string | null>(initialMeta.id);
  const [stationName, setStationName] = useState(
    initialMeta.name || 'PC Magasin Principal'
  );
  const [depotFilter, setDepotFilter] = useState(
    initialMeta.depot || 'ALL'
  );
  const [autoMode, setAutoMode] = useState(isPrintStationAutoModeEnabled());
  const [soundEnabled, setSoundEnabled] = useState(isPrintStationSoundEnabled());
  const [paused, setPaused] = useState(false);

  const [stationRecord, setStationRecord] = useState<PrintStationRecord | null>(
    null
  );
  const [jobs, setJobs] = useState<PrintJobRecord[]>([]);
  const [selectedJob, setSelectedJob] = useState<PrintJobRecord | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'QUEUE' | 'HISTORY'>('QUEUE');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Desktop System Printers & ZPL Settings
  const [printers, setPrinters] = useState<DesktopPrinterInfo[]>([]);
  const [defaultPrinterName, setDefaultPrinterName] = useState<string>('');
  const [silentPrint, setSilentPrint] = useState<boolean>(true);
  const [zplSettings, setZplSettings] = useState<DesktopZplSettings>(
    DEFAULT_DESKTOP_ZPL_SETTINGS
  );
  const [testingZpl, setTestingZpl] = useState(false);

  const isProcessingRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    async function loadDesktopPrintingConfig() {
      const [list, printCfg, zpl] = await Promise.all([
        listDesktopPrinters(),
        getDesktopPrintSettings(),
        getDesktopZplSettings(),
      ]);
      if (!mounted) return;
      setPrinters(list);
      setDefaultPrinterName(printCfg.printerName || '');
      setSilentPrint(printCfg.silent);
      setZplSettings(zpl);
    }
    loadDesktopPrintingConfig();
    return () => {
      mounted = false;
    };
  }, []);

  const refreshStationAndJobs = useCallback(async () => {
    const reg = await rpcRegisterPrintStation(
      stationName,
      depotFilter === 'ALL' ? null : depotFilter
    );
    if (reg.stationId) {
      setStationId(reg.stationId);
      setSavedPrintStationConfig(
        reg.stationId,
        stationName,
        depotFilter === 'ALL' ? null : depotFilter
      );
      const stationsRes = await rpcListPrintStations();
      const foundStation = stationsRes.stations.find((s) => s.id === reg.stationId) || null;
      setStationRecord(foundStation);

      const listRes = await rpcListStationPrintJobs(reg.stationId, 30);
      if (!listRes.error) {
        setJobs(listRes.jobs);
      }
    }
  }, [stationName, depotFilter]);

  useEffect(() => {
    refreshStationAndJobs();
    const timer = setInterval(refreshStationAndJobs, 8000);
    return () => clearInterval(timer);
  }, [refreshStationAndJobs]);

  const executePrintJob = useCallback(
    async (job: PrintJobRecord) => {
      try {
        if (soundEnabled) playPrintStationNotificationChime();
        const res = await executeStationPrintJob(job, products, orders, {
          canViewPrices,
          locale,
          printerName: defaultPrinterName || undefined,
          silent: silentPrint,
        });
        await rpcCompletePrintJob(job.id, res.ok, res.ok ? null : res.error || null);
        await refreshStationAndJobs();
      } catch (err: any) {
        await rpcCompletePrintJob(
          job.id,
          false,
          err?.message || tr(language, "Erreur d'impression", 'Print error', 'Afdrukfout')
        );
        await refreshStationAndJobs();
      }
    },
    [
      products,
      orders,
      canViewPrices,
      locale,
      soundEnabled,
      defaultPrinterName,
      silentPrint,
      refreshStationAndJobs,
      language,
    ]
  );

  // Auto-claim next pending jobs when autoMode is enabled and not paused
  useEffect(() => {
    const activeStationId = stationRecord?.id || stationId;
    if (!autoMode || paused || !activeStationId) return;
    const pending = jobs.find((j) => j.status === 'PENDING');
    if (!pending || isProcessingRef.current) return;

    isProcessingRef.current = true;
    rpcClaimPrintJobs(activeStationId)
      .then(async (claim) => {
        for (const claimedJob of claim.jobs) {
          await executePrintJob(claimedJob);
        }
      })
      .finally(() => {
        isProcessingRef.current = false;
      });
  }, [autoMode, paused, stationRecord, stationId, jobs, executePrintJob]);

  // Update preview when selecting a job
  useEffect(() => {
    let cancelled = false;
    async function renderPreview() {
      const target = selectedJob || jobs[0];
      if (!target) {
        setPreviewHtml('');
        return;
      }
      const doc = await buildPrintableHtmlForStationJob(target, products, orders, {
        canViewPrices,
        locale,
      });
      if (!cancelled) {
        setPreviewHtml(doc.html);
      }
    }
    renderPreview();
    return () => {
      cancelled = true;
    };
  }, [selectedJob, jobs, products, orders, canViewPrices, locale]);

  const handleUpdateZpl = async (patch: Partial<DesktopZplSettings>) => {
    const updated = await setDesktopZplSettings(patch);
    setZplSettings(updated);
  };

  const handleTestZpl = async () => {
    setTestingZpl(true);
    setStatusMessage(null);
    try {
      const zplString = generateProductZplLabel(
        {
          reference: 'TEST-ZPL-01',
          brand: 'TOT Stock',
          model: stationName || 'Station Impression',
          barcode: 'TEST-ZPL-01',
          qr_code: 'TOT-PROD:TEST-ZPL-01',
          store_name: depotFilter === 'ALL' ? 'Dépôt Principal' : depotFilter,
          room_name: '',
          shelf_name: '',
          rack_location: 'A1-01',
        },
        {
          format: zplSettings.format,
          dpi: zplSettings.dpi,
          offsetXMm: zplSettings.offsetXMm,
          offsetYMm: zplSettings.offsetYMm,
          speed: zplSettings.speed,
          darkness: zplSettings.darkness,
        }
      );
      const res = await printDesktopZplRaw({
        zpl: zplString,
        transport: zplSettings.transport,
        host: zplSettings.host,
        port: zplSettings.port,
        rawPrinterName: zplSettings.rawPrinterName,
      });
      if (res.ok) {
        setStatusMessage(
          tr(
            language,
            'Étiquette de test ZPL envoyée avec succès.',
            'ZPL test label sent successfully.',
            'ZPL-testetiket succesvol verzonden.'
          )
        );
      } else {
        setStatusMessage(
          `${tr(language, 'Échec ZPL :', 'ZPL failed:', 'ZPL mislukt:')} ${res.errorMessage || tr(language, 'Erreur inconnue', 'Unknown error', 'Onbekende fout')}`
        );
      }
    } finally {
      setTestingZpl(false);
    }
  };

  const queueJobs = jobs.filter(
    (j) => j.status === 'PENDING' || j.status === 'PRINTING'
  );
  const historyJobs = jobs.filter(
    (j) => j.status !== 'PENDING' && j.status !== 'PRINTING'
  );
  const displayedJobs = activeTab === 'QUEUE' ? queueJobs : historyJobs;

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-50 dark:bg-slate-950">
      {/* Top Station Bar */}
      <div className="px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-950/70 text-orange-600 flex items-center justify-center">
            <Printer className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-black text-slate-900 dark:text-white">
                {tr(language, "Poste d'impression d'étiquettes", 'Label Print Station', 'Etiketten-afdrukstation')}
              </h1>
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                  paused
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {paused
                  ? tr(language, 'En pause', 'Paused', 'Gepauzeerd')
                  : tr(language, 'Poste en ligne', 'Station online', 'Station online')}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {tr(
                language,
                'Réception en temps réel des étiquettes envoyées depuis les terminaux mobiles et douchettes',
                'Real-time reception of labels sent from mobile terminals and barcode scanners',
                'Realtime ontvangst van etiketten verzonden vanaf mobiele terminals en handscanners'
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold border transition-colors ${
              paused
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-amber-300 bg-amber-50 text-amber-800'
            }`}
          >
            {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            {paused
              ? tr(language, 'Reprendre les impressions', 'Resume printing', 'Afdrukken hervatten')
              : tr(language, 'Mettre en pause', 'Pause', 'Pauzeren')}
          </button>

          {isDesktopApp() && (
            <button
              type="button"
              onClick={() => openDesktopSecondaryWindow('print_station')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50"
            >
              <ExternalLink className="w-3.5 h-3.5 text-orange-500" />
              {tr(language, 'Fenêtre dédiée', 'Detached window', 'Losstaand venster')}
            </button>
          )}
        </div>
      </div>

      {/* Main Split Grid */}
      <div className="flex-1 min-h-0 grid grid-cols-12 divide-x divide-slate-200 dark:divide-slate-800 overflow-hidden">
        {/* Left Column: Station Settings, Printers & Queue (7 cols) */}
        <div className="col-span-7 flex flex-col h-full min-h-0 overflow-y-auto p-6 space-y-5">
          {/* Station Identity & System Printer */}
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                <Settings2 className="w-4 h-4 text-orange-500" />
                {tr(language, "Configuration du poste d'impression", 'Print station configuration', 'Configuratie afdrukstation')}
              </span>
              <button
                type="button"
                onClick={refreshStationAndJobs}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-orange-600 hover:underline"
              >
                <RefreshCw className="w-3 h-3" />
                {tr(language, 'Mettre à jour poste', 'Update station', 'Station bijwerken')}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-600 dark:text-slate-400 mb-1">
                  {tr(language, "Nom du poste d'impression", 'Print station name', 'Naam afdrukstation')}
                </label>
                <input
                  type="text"
                  value={stationName}
                  onChange={(e) => {
                    setStationName(e.target.value);
                    setSavedPrintStationConfig(
                      stationId,
                      e.target.value,
                      depotFilter === 'ALL' ? null : depotFilter
                    );
                  }}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 dark:text-slate-400 mb-1">
                  {tr(language, 'Dépôt rattaché', 'Linked depot', 'Gekoppeld depot')}
                </label>
                <SearchableSelect
                  value={depotFilter}
                  onChange={(val) => {
                    setDepotFilter(val);
                    setSavedPrintStationConfig(
                      stationId,
                      stationName,
                      val === 'ALL' ? null : val
                    );
                  }}
                  recentKey="depots"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
                >
                  <option value="ALL">
                    {tr(language, 'Tous les dépôts autorisés', 'All authorized depots', 'Alle toegestane depots')}
                  </option>
                  {depots.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </SearchableSelect>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <label className="flex items-center gap-2 cursor-pointer font-semibold">
                <input
                  type="checkbox"
                  checked={autoMode}
                  onChange={(e) => {
                    setAutoMode(e.target.checked);
                    setPrintStationAutoModeEnabled(e.target.checked);
                  }}
                  className="rounded text-orange-600"
                />
                {tr(language, 'Imprimer automatiquement dès réception', 'Auto-print upon reception', 'Automatisch afdrukken bij ontvangst')}
              </label>

              <button
                type="button"
                onClick={() => {
                  const next = !soundEnabled;
                  setSoundEnabled(next);
                  setPrintStationSoundEnabled(next);
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
              >
                {soundEnabled ? (
                  <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5 text-slate-400" />
                )}
                {soundEnabled
                  ? tr(language, 'Son activé', 'Sound on', 'Geluid aan')
                  : tr(language, 'Son coupé', 'Sound muted', 'Geluid uit')}
              </button>

              {printers.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">{tr(language, 'Imprimante système :', 'System printer:', 'Systeemprinter:')}</span>
                  <SearchableSelect
                    value={defaultPrinterName}
                    onChange={async (val) => {
                      setDefaultPrinterName(val);
                      await setDesktopPrintSettings({
                        printerName: val,
                        silent: silentPrint,
                      });
                    }}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold"
                  >
                    <option value="">
                      {tr(language, 'Imprimante système par défaut', 'Default system printer', 'Standaard systeemprinter')}
                    </option>
                    {printers.map((pr) => (
                      <option key={pr.name} value={pr.name}>
                        {pr.displayName || pr.name}
                      </option>
                    ))}
                  </SearchableSelect>
                </div>
              )}
            </div>
          </div>

          {/* Zebra ZPL II Direct Thermal Configuration */}
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-orange-600" />
                <span className="font-black text-slate-900 dark:text-white">
                  {tr(
                    language,
                    "Imprimante thermique d'étiquettes Zebra (ZPL II direct)",
                    'Zebra Thermal Label Printer (Direct ZPL II)',
                    'Zebra thermische etikettenprinter (Direct ZPL II)'
                  )}
                </span>
              </div>
              <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
                <input
                  type="checkbox"
                  checked={zplSettings.enabled}
                  onChange={(e) => handleUpdateZpl({ enabled: e.target.checked })}
                  className="rounded text-orange-600"
                />
                {tr(language, 'Activer ZPL direct', 'Enable direct ZPL', 'Direct ZPL inschakelen')}
              </label>
            </div>

            <div className="grid grid-cols-4 gap-2.5">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  {tr(language, 'Mode de connexion', 'Connection mode', 'Verbindingsmodus')}
                </label>
                <SearchableSelect
                  value={zplSettings.transport}
                  onChange={(val) =>
                    handleUpdateZpl({
                      transport: val as ZplTransportMode,
                    })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
                >
                  <option value="tcp">
                    {tr(language, 'Réseau TCP/IP (9100)', 'TCP/IP Network (9100)', 'TCP/IP-netwerk (9100)')}
                  </option>
                  <option value="raw_queue">
                    {tr(language, 'Spouleur USB RAW', 'USB RAW Spooler', 'USB RAW-spooler')}
                  </option>
                </SearchableSelect>
              </div>

              {zplSettings.transport === 'tcp' ? (
                <>
                  <div className="col-span-2">
                    <label className="block text-[11px] text-slate-500 mb-1">
                      {tr(language, "Adresse IP de l'imprimante", 'Printer IP address', 'IP-adres van printer')}
                    </label>
                    <input
                      type="text"
                      value={zplSettings.host}
                      onChange={(e) => handleUpdateZpl({ host: e.target.value })}
                      placeholder="192.168.1.200"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">
                      {tr(language, 'Port TCP', 'TCP Port', 'TCP-poort')}
                    </label>
                    <input
                      type="number"
                      value={zplSettings.port}
                      onChange={(e) =>
                        handleUpdateZpl({ port: Number(e.target.value) || 9100 })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                    />
                  </div>
                </>
              ) : (
                <div className="col-span-3">
                  <label className="block text-[11px] text-slate-500 mb-1">
                    {tr(language, 'Imprimante USB/Série RAW', 'RAW USB/Serial Printer', 'RAW USB/Seriële printer')}
                  </label>
                  <input
                    type="text"
                    value={zplSettings.rawPrinterName || ''}
                    onChange={(e) =>
                      handleUpdateZpl({ rawPrinterName: e.target.value || '' })
                    }
                    placeholder="ZDesigner ZD421-203dpi ZPL"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-4 gap-2.5 items-end">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  {tr(language, 'Format rouleau', 'Roll format', 'Rolformaat')}
                </label>
                <SearchableSelect
                  value={zplSettings.format}
                  onChange={(val) =>
                    handleUpdateZpl({
                      format: val as DesktopZplSettings['format'],
                    })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
                >
                  <option value="50x30">50 × 30 mm</option>
                  <option value="70x37">70 × 37 mm</option>
                  <option value="90x50">90 × 50 mm</option>
                </SearchableSelect>
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  {tr(language, 'Résolution tête', 'Printhead resolution', 'Printkopresolutie')}
                </label>
                <SearchableSelect
                  value={zplSettings.dpi}
                  onChange={(val) =>
                    handleUpdateZpl({
                      dpi: Number(val) === 300 ? 300 : 203,
                    })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                >
                  <option value={203}>203 dpi (8 dpmm)</option>
                  <option value={300}>300 dpi (12 dpmm)</option>
                </SearchableSelect>
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  {tr(language, 'Décalage X / Y (mm)', 'Offset X / Y (mm)', 'Verschuiving X / Y (mm)')}
                </label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    value={zplSettings.offsetXMm}
                    onChange={(e) =>
                      handleUpdateZpl({ offsetXMm: Number(e.target.value) || 0 })
                    }
                    className="w-1/2 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                  />
                  <input
                    type="number"
                    value={zplSettings.offsetYMm}
                    onChange={(e) =>
                      handleUpdateZpl({ offsetYMm: Number(e.target.value) || 0 })
                    }
                    className="w-1/2 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={testingZpl}
                onClick={handleTestZpl}
                className="py-1.5 px-3 rounded-lg font-bold bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white"
              >
                {testingZpl
                  ? tr(language, 'Envoi...', 'Sending...', 'Verzenden...')
                  : tr(language, 'Étiquette de test', 'Test label', 'Testetiket')}
              </button>
            </div>

            {statusMessage && (
              <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium">
                {statusMessage}
              </div>
            )}
          </div>

          {/* Queue & History Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex-1 flex flex-col min-h-[260px]">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setActiveTab('QUEUE')}
                  className={`px-3 py-1 rounded-lg ${
                    activeTab === 'QUEUE'
                      ? 'bg-orange-600 text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {tr(language, "File d'attente", 'Print queue', 'Wachtrij')} ({queueJobs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('HISTORY')}
                  className={`px-3 py-1 rounded-lg ${
                    activeTab === 'HISTORY'
                      ? 'bg-orange-600 text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {tr(language, 'Historique récent', 'Recent history', 'Recente geschiedenis')} ({historyJobs.length})
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await rpcPurgePrintJobs();
                    await refreshStationAndJobs();
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {tr(language, 'Purger anciens', 'Purge old', 'Oude wissen')}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] font-bold uppercase text-slate-500">
                  <tr>
                    <th className="py-2 px-3">{tr(language, 'Heure', 'Time', 'Tijd')}</th>
                    <th className="py-2 px-3">{tr(language, 'Type', 'Type', 'Type')}</th>
                    <th className="py-2 px-3">{tr(language, 'Cible', 'Target', 'Doel')}</th>
                    <th className="py-2 px-3">{tr(language, 'Format / Copies', 'Format / Copies', 'Formaat / Kopieën')}</th>
                    <th className="py-2 px-3">{tr(language, 'Statut', 'Status', 'Status')}</th>
                    <th className="py-2 px-3 text-right">{tr(language, 'Actions', 'Actions', 'Acties')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {displayedJobs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-400">
                        {activeTab === 'QUEUE'
                          ? tr(language, "Aucun travail d'impression en attente.", 'No pending print jobs.', 'Geen afdruktaken in de wachtrij.')
                          : tr(language, 'Aucun historique récent.', 'No recent history.', 'Geen recente geschiedenis.')}
                      </td>
                    </tr>
                  ) : (
                    displayedJobs.map((job) => (
                      <tr
                        key={job.id}
                        onClick={() => setSelectedJob(job)}
                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">
                          {new Date(job.created_at).toLocaleTimeString(locale)}
                        </td>
                        <td className="py-2.5 px-3 font-semibold">
                          {job.kind === 'order_label'
                            ? tr(language, 'Bon Commande', 'Order Slip', 'Bestelbon')
                            : tr(language, 'Étiquette Article', 'Product Label', 'Artikeletiket')}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-orange-600">
                          {String(
                            job.payload?.order_number ||
                              job.payload?.product_ref ||
                              job.id.slice(0, 8)
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px]">
                          {job.format} ×{job.copies}
                        </td>
                        <td className="py-2.5 px-3">
                          {job.status === 'DONE' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-bold">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {tr(language, 'Imprimé', 'Printed', 'Afgedrukt')}
                            </span>
                          ) : job.status === 'FAILED' ? (
                            <span className="inline-flex items-center gap-1 text-rose-600 font-bold">
                              <XCircle className="w-3.5 h-3.5" />
                              {tr(language, 'Échec', 'Failed', 'Mislukt')}
                            </span>
                          ) : (
                            <span className="font-bold text-amber-600">
                              {job.status}
                            </span>
                          )}
                        </td>
                        <td
                          className="py-2.5 px-3 text-right space-x-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => executePrintJob(job)}
                            className="px-2 py-1 rounded bg-orange-600 text-white font-bold text-[11px]"
                          >
                            {tr(language, 'Imprimer', 'Print', 'Afdrukken')}
                          </button>
                          {job.status === 'FAILED' && (
                            <button
                              type="button"
                              onClick={() => executePrintJob(job)}
                              className="p-1 rounded border border-slate-200 dark:border-slate-700"
                              title={tr(language, 'Relancer', 'Retry', 'Opnieuw')}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {job.status === 'PENDING' && (
                            <button
                              type="button"
                              onClick={async () => {
                                await rpcCancelPrintJob(job.id);
                                await refreshStationAndJobs();
                              }}
                              className="p-1 rounded border border-rose-200 text-rose-600"
                              title={tr(language, 'Annuler', 'Cancel', 'Annuleren')}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: Live Label Preview (5 cols) */}
        <div className="col-span-5 flex flex-col h-full min-h-0 bg-slate-100 dark:bg-slate-950 p-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black uppercase tracking-wider text-slate-500">
              {tr(language, "Aperçu de l'étiquette sélectionnée", 'Selected label preview', 'Voorbeeld van geselecteerd etiket')}
            </span>
            {(selectedJob || jobs[0]) && (
              <button
                type="button"
                onClick={() => executePrintJob((selectedJob || jobs[0])!)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white"
              >
                <Printer className="w-3.5 h-3.5" />
                {tr(language, "Lancer l'impression", 'Start printing', 'Afdrukken starten')}
              </button>
            )}
          </div>

          <div className="flex-1 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-inner p-6 overflow-auto flex items-center justify-center">
            {previewHtml ? (
              <div
                className="bg-white text-slate-900 p-4 rounded-xl shadow-md border border-slate-200"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : (
              <div className="text-xs text-slate-400 text-center">
                {tr(
                  language,
                  "Sélectionnez un travail dans la file d'attente pour prévisualiser l'étiquette.",
                  'Select a job in the queue to preview the label.',
                  'Selecteer een taak in de wachtrij om het etiket te bekijken.'
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
