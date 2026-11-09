import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardCheck,
  Search,
  FileSpreadsheet,
  Printer,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Barcode,
  History,
  Layers,
  Plus,
  Minus,
  Check,
  ArrowUpDown,
  Building2,
  Eye,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { tr } from '../../i18n/dutchTranslator';
import { formatCurrency, playScanBeep } from '../../utils/crypto';
import { SearchableSelect } from '../../components/SearchableSelect';
import { ProductRefLink } from '../../components/ProductRefLink';
import {
  getClientSupabase,
  fetchInventoryAuditsFromSupabase,
  retryQueuedInventoryAudit,
  discardQueuedInventoryAudit,
} from '../../services/clientSupabase';
import {
  getQueuedInventoryAudits,
  SyncOperation,
} from '../../services/offline/indexedDb';
import {
  AuditCountingRow,
  AuditHistoryRecord,
  buildAuditAdjustmentsFromSession,
  buildAuditPrintableReportHtml,
  buildAuditReportCsvContent,
  buildDepotAuditCountingRows,
  buildStockByDepotMatrix,
  buildStockByDepotMatrixCsv,
  getAllowedAuditDepotColumns,
} from '../../services/inventoryAuditLogic';

const DESKTOP_AUDIT_SESSION_KEY = 'tot_inventory_audit_session_v1';

export type DesktopAuditTabId = 'matrix' | 'counting' | 'history';

interface DesktopAuditPageProps {
  selectedDepotFilter?: string;
}

export const DesktopAuditPage: React.FC<DesktopAuditPageProps> = ({
  selectedDepotFilter = 'ALL',
}) => {
  const {
    products,
    depots,
    stockLevels,
    subCategories,
    users,
    currentUser,
    applyInventoryAdjustments,
    userHasPermission,
    language,
    t,
    supabaseUrl,
    supabaseKey,
    inventoryAuditTargetDepot,
  } = useApp();

  const canAudit =
    userHasPermission('perm_menu_inventory_audit') || Number(currentUser?.role_id) === 0;
  const canValidate =
    userHasPermission('perm_inventory_validate') || Number(currentUser?.role_id) === 0;
  const canViewPrices = userHasPermission('perm_prod_view_price');

  const [activeTab, setActiveTab] = useState<DesktopAuditTabId>('matrix');

  // Allowed depots for current user
  const allowedDepots = useMemo(
    () => getAllowedAuditDepotColumns(depots, products, stockLevels, currentUser, users),
    [depots, products, stockLevels, currentUser, users]
  );

  // =========================================================================
  // TAB 1 : VUE « STOCK PAR DÉPÔT » (MATRICE RÉFÉRENCE × DÉPÔTS)
  // =========================================================================
  const [matrixSearch, setMatrixSearch] = useState('');
  const [matrixCategory, setMatrixCategory] = useState('ALL');
  const [matrixBrand, setMatrixBrand] = useState('ALL');
  const [matrixDiscrepancyOnly, setMatrixDiscrepancyOnly] = useState(false);
  const [matrixSortBy, setMatrixSortBy] = useState<string>('reference');
  const [matrixSortDir, setMatrixSortDir] = useState<'asc' | 'desc'>('asc');

  const uniqueBrands = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.brand && p.brand.trim()) set.add(p.brand.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
  }, [products]);

  const matrixResult = useMemo(
    () =>
      buildStockByDepotMatrix(products, depots, stockLevels, subCategories, currentUser, {
        searchQuery: matrixSearch,
        categoryId: matrixCategory,
        brand: matrixBrand === 'ALL' ? '' : matrixBrand,
        discrepancyOnly: matrixDiscrepancyOnly,
        sortBy: matrixSortBy,
        sortDir: matrixSortDir,
        users,
      }),
    [
      products,
      depots,
      stockLevels,
      subCategories,
      currentUser,
      users,
      matrixSearch,
      matrixCategory,
      matrixBrand,
      matrixDiscrepancyOnly,
      matrixSortBy,
      matrixSortDir,
    ]
  );

  const toggleMatrixSort = (col: string) => {
    if (matrixSortBy === col) {
      setMatrixSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setMatrixSortBy(col);
      setMatrixSortDir('asc');
    }
  };

  const handleExportMatrixCsv = () => {
    const csvContent = buildStockByDepotMatrixCsv(
      matrixResult.rows,
      matrixResult.depotColumns,
      canViewPrices
    );
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const nowStr = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `Matrice_Stock_Par_Depot_${nowStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // =========================================================================
  // TAB 2 : VUE « COMPTAGE » (INVENTAIRE PHYSIQUE PAR DÉPÔT)
  // =========================================================================
  const [selectedDepot, setSelectedDepot] = useState<string>(() => {
    if (inventoryAuditTargetDepot) return inventoryAuditTargetDepot;
    if (selectedDepotFilter && selectedDepotFilter !== 'ALL') return selectedDepotFilter;
    return allowedDepots[0] || 'ALL';
  });

  useEffect(() => {
    if (inventoryAuditTargetDepot) {
      setSelectedDepot(inventoryAuditTargetDepot);
      setActiveTab('counting');
    }
  }, [inventoryAuditTargetDepot]);

  useEffect(() => {
    if (selectedDepotFilter && selectedDepotFilter !== 'ALL') {
      setSelectedDepot(selectedDepotFilter);
    }
  }, [selectedDepotFilter]);

  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [zoneQuery, setZoneQuery] = useState<string>('');
  const [countingSearch, setCountingSearch] = useState<string>('');
  const [tableFilter, setTableFilter] = useState<
    'ALL' | 'DIFF_ONLY' | 'MATCHED' | 'MISSING' | 'SURPLUS' | 'UNCOUNTED'
  >('ALL');

  const [counts, setCounts] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(DESKTOP_AUDIT_SESSION_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(DESKTOP_AUDIT_SESSION_KEY, JSON.stringify(counts));
    } catch {
      // Ignore quota errors
    }
  }, [counts]);

  const [scanInput, setScanInput] = useState('');
  const [scanStep, setScanStep] = useState<number>(1);
  const [scanMode, setScanMode] = useState<'ADD' | 'SET'>('ADD');
  // V61 : saisie manuelle de la quantité après chaque scan
  const [manualAfterScan, setManualAfterScan] = useState<boolean>(() => {
    try {
      return localStorage.getItem('tot_audit_manual_after_scan') === '1';
    } catch {
      return false;
    }
  });
  const [pendingManualRow, setPendingManualRow] = useState<AuditCountingRow | null>(null);
  const [manualQty, setManualQty] = useState<string>('');
  const manualQtyInputRef = useRef<HTMLInputElement | null>(null);
  const [scanFeedback, setScanFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [showValidateConfirm, setShowValidateConfirm] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  const scanInputRef = useRef<HTMLInputElement | null>(null);

  const { scopeRows, filteredRows, stats } = useMemo(
    () =>
      buildDepotAuditCountingRows({
        products,
        stockLevels,
        subCategories,
        currentUser,
        depots,
        users,
        selectedDepot,
        selectedCategory,
        zoneQuery,
        searchQuery: countingSearch,
        tableFilter,
        counts,
      }),
    [
      products,
      stockLevels,
      subCategories,
      currentUser,
      depots,
      users,
      selectedDepot,
      selectedCategory,
      zoneQuery,
      countingSearch,
      tableFilter,
      counts,
    ]
  );

  const recordCount = useCallback(
    (row: AuditCountingRow, qty: number, isAddition = false) => {
      const prev = counts[row.productId] ?? null;
      let nextVal = qty;
      if (isAddition && prev !== null) {
        nextVal = prev + qty;
      }
      if (nextVal < 0) nextVal = 0;

      setCounts((curr) => ({
        ...curr,
        [row.productId]: nextVal,
      }));

      const diff = nextVal - row.theoreticalQty;
      playScanBeep(true);
      setScanFeedback({
        type: diff === 0 ? 'success' : diff < 0 ? 'warning' : 'success',
        text: `${row.reference} (${row.depotName}) : ${nextVal} (${diff >= 0 ? '+' : ''}${diff})`,
      });
      setTimeout(() => setScanFeedback(null), 2500);
    },
    [counts]
  );

  const handleUsbScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = scanInput.trim();
    if (!raw) return;
    const target = raw.toLowerCase();

    const matched =
      scopeRows.find((r) => {
        const ref = r.reference.trim().toLowerCase();
        const bc = r.barcode.trim().toLowerCase();
        const qr = (r.product.qr_code || '').trim().toLowerCase();
        const oem = (r.product.manufacturer_ref || '').trim().toLowerCase();
        const id = r.productId.trim().toLowerCase();
        return ref === target || (bc && bc === target) || (qr && qr === target) || (oem && oem === target) || id === target;
      }) || scopeRows.find((r) => r.reference && raw.includes(r.reference));

    if (!matched) {
      playScanBeep(false);
      setScanFeedback({
        type: 'error',
        text: tr(
          language,
          `Code introuvable dans le périmètre (${selectedDepot}) : "${raw}"`,
          `Code not found in scope (${selectedDepot}): "${raw}"`,
          `Code niet gevonden in bereik (${selectedDepot}): "${raw}"`
        ),
      });
      setTimeout(() => setScanFeedback(null), 2500);
      return;
    }

    if (manualAfterScan) {
      playScanBeep(true);
      setPendingManualRow(matched);
      const prevCount = counts[matched.productId];
      setManualQty(prevCount !== undefined && prevCount !== null && scanMode === 'SET' ? String(prevCount) : '');
      setScanInput('');
      setTimeout(() => manualQtyInputRef.current?.focus(), 60);
      return;
    }

    recordCount(matched, scanStep, scanMode === 'ADD');
    setScanInput('');
    scanInputRef.current?.focus();
  };

  const confirmManualQty = () => {
    if (!pendingManualRow) return;
    const n = Number(String(manualQty).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return;
    recordCount(pendingManualRow, Math.round(n), scanMode === 'ADD');
    setPendingManualRow(null);
    setManualQty('');
    setTimeout(() => scanInputRef.current?.focus(), 60);
  };

  const toggleManualAfterScan = () => {
    const next = !manualAfterScan;
    setManualAfterScan(next);
    try {
      localStorage.setItem('tot_audit_manual_after_scan', next ? '1' : '0');
    } catch {}
    if (!next) {
      setPendingManualRow(null);
      setManualQty('');
    }
  };

  const handleResetSession = () => {
    setCounts({});
    localStorage.removeItem(DESKTOP_AUDIT_SESSION_KEY);
    setStatusBanner(null);
  };

  const handleExportCountingCsv = () => {
    const csvContent = buildAuditReportCsvContent(scopeRows, canViewPrices);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const nowStr = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `Rapport_Audit_${selectedDepot}_${nowStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const printHtmlDocument = (html: string) => {
    const printIframeId = 'tot-desktop-audit-print-iframe';
    let printIframe = document.getElementById(printIframeId) as HTMLIFrameElement | null;
    if (!printIframe) {
      printIframe = document.createElement('iframe');
      printIframe.id = printIframeId;
      printIframe.style.position = 'fixed';
      printIframe.style.right = '0';
      printIframe.style.bottom = '0';
      printIframe.style.width = '0';
      printIframe.style.height = '0';
      printIframe.style.border = '0';
      document.body.appendChild(printIframe);
    }

    const doc = printIframe.contentDocument || printIframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();

    setTimeout(() => {
      try {
        printIframe?.contentWindow?.focus();
        printIframe?.contentWindow?.print();
      } catch {
        window.print();
      }
    }, 350);
  };

  const handlePrintCurrentSessionReport = () => {
    const dateStr = new Date().toLocaleDateString(tr(language, 'fr-FR', 'en-US', 'nl-NL'), {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const depotLabel =
      selectedDepot === 'ALL'
        ? tr(language, 'Tous les dépôts autorisés', 'All allowed depots', 'Alle toegestane depots')
        : selectedDepot;

    const html = buildAuditPrintableReportHtml({
      title: t('audit_report_title'),
      subtitle: t('audit_report_subtitle'),
      dateStr,
      auditorName: currentUser?.name || 'Administrateur',
      depotLabel,
      rows: scopeRows,
      stats,
      canViewPrices,
      sigAuditorLabel: t('audit_report_sig_auditor'),
      sigManagerLabel: t('audit_report_sig_manager'),
    });
    printHtmlDocument(html);
  };

  // =========================================================================
  // TAB 3 : « HISTORIQUE DES AUDITS » (inventory_audits & inventory_audit_items)
  // =========================================================================
  const [auditHistory, setAuditHistory] = useState<AuditHistoryRecord[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [queuedAudits, setQueuedAudits] = useState<SyncOperation[]>([]);
  const [retryingQueueId, setRetryingQueueId] = useState<string | null>(null);
  const [selectedHistoryAuditId, setSelectedHistoryAuditId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const client = getClientSupabase(supabaseUrl, supabaseKey);
      const [res, queued] = await Promise.all([
        fetchInventoryAuditsFromSupabase(client),
        getQueuedInventoryAudits().catch(() => [] as SyncOperation[]),
      ]);
      setQueuedAudits(queued);
      if (!res.success) {
        setHistoryError(
          res.error ||
            tr(
              language,
              'Erreur lors de la lecture des audits',
              'Error reading audit history',
              'Fout bij het lezen van de auditgeschiedenis'
            )
        );
        setAuditHistory([]);
      } else {
        setHistoryError(null);
        setAuditHistory(res.audits);
        if (res.audits.length > 0 && !selectedHistoryAuditId) {
          setSelectedHistoryAuditId(res.audits[0].id);
        }
      }
    } finally {
      setLoadingHistory(false);
    }
  }, [supabaseUrl, supabaseKey, selectedHistoryAuditId, language]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleRetryQueuedAudit = async (opId: string) => {
    setRetryingQueueId(opId);
    try {
      const client = getClientSupabase(supabaseUrl, supabaseKey);
      const res = await retryQueuedInventoryAudit(client, opId);
      if (!res.success) {
        setStatusBanner({
          type: 'warning',
          text:
            res.error ||
            tr(
              language,
              "Stock régularisé, mais l'historique n'a pas pu être enregistré",
              'Stock reconciled, but history could not be saved',
              'Voorraad gecorrigeerd, maar geschiedenis kon niet worden opgeslagen'
            ),
        });
      } else {
        setStatusBanner({
          type: 'success',
          text: tr(
            language,
            "Historique d'audit enregistré avec succès.",
            'Audit history recorded successfully.',
            'Auditgeschiedenis succesvol geregistreerd.'
          ),
        });
      }
      await loadHistory();
    } finally {
      setRetryingQueueId(null);
    }
  };

  const handleDiscardQueuedAudit = async (opId: string) => {
    await discardQueuedInventoryAudit(opId);
    await loadHistory();
  };

  const handleValidateAuditSession = async () => {
    if (!canValidate) return;
    setIsValidating(true);
    setStatusBanner(null);

    const adjustments = buildAuditAdjustmentsFromSession(
      scopeRows,
      counts,
      selectedDepot,
      'Régularisation Inventaire Physique TOT'
    );
    const targetDepotOverride = selectedDepot !== 'ALL' ? selectedDepot : undefined;
    const res = await applyInventoryAdjustments(adjustments, targetDepotOverride);

    setIsValidating(false);
    setShowValidateConfirm(false);

    if (res.success) {
      if (res.warningMessage || res.auditHistorySaved === false) {
        const warnText =
          res.warningMessage ||
          tr(
            language,
            "Stock régularisé, mais l'historique n'a pas pu être enregistré",
            'Stock reconciled, but history could not be saved',
            'Voorraad gecorrigeerd, maar geschiedenis kon niet worden opgeslagen'
          );
        setStatusBanner({
          type: 'warning',
          text: `${warnText} (${res.message})`,
        });
      } else {
        setStatusBanner({
          type: 'success',
          text: res.message,
        });
      }
      setCounts({});
      localStorage.removeItem(DESKTOP_AUDIT_SESSION_KEY);
      await loadHistory();
    } else {
      setStatusBanner({
        type: 'error',
        text: res.message,
      });
    }
  };

  const selectedHistoryAudit = useMemo(
    () => auditHistory.find((a) => a.id === selectedHistoryAuditId) || auditHistory[0] || null,
    [auditHistory, selectedHistoryAuditId]
  );

  const handleExportHistoryAuditCsv = (audit: AuditHistoryRecord) => {
    const rows: AuditCountingRow[] = (audit.items || []).map((it) => ({
      product: {
        id: it.product_id,
        reference: it.product_ref,
        brand: '',
        model: it.product_name || it.product_ref,
        quantity: it.physical_count,
        min_stock_alert: 0,
        unit_price: it.unit_price,
        store_name: audit.depot_name,
      },
      productId: it.product_id,
      reference: it.product_ref,
      brand: '',
      model: it.product_name || '',
      barcode: it.scanned_barcode || '',
      categoryName: '—',
      depotName: audit.depot_name,
      rackLocation: '',
      theoreticalQty: it.theoretical_qty,
      countedQty: it.physical_count,
      difference: it.difference,
      unitPrice: it.unit_price,
      differenceValue: it.diff_cost * (it.difference < 0 ? -1 : 1),
      isCounted: true,
    }));

    const csvContent = buildAuditReportCsvContent(rows, canViewPrices);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Audit_${audit.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleReprintHistoryAudit = (audit: AuditHistoryRecord) => {
    const rows: AuditCountingRow[] = (audit.items || []).map((it) => ({
      product: {
        id: it.product_id,
        reference: it.product_ref,
        brand: '',
        model: it.product_name || it.product_ref,
        quantity: it.physical_count,
        min_stock_alert: 0,
        unit_price: it.unit_price,
        store_name: audit.depot_name,
      },
      productId: it.product_id,
      reference: it.product_ref,
      brand: '',
      model: it.product_name || '',
      barcode: it.scanned_barcode || '',
      categoryName: '—',
      depotName: audit.depot_name,
      rackLocation: '',
      theoreticalQty: it.theoretical_qty,
      countedQty: it.physical_count,
      difference: it.difference,
      unitPrice: it.unit_price,
      differenceValue: it.difference * (it.unit_price || 0),
      isCounted: true,
    }));

    const missingCount = rows.filter((r) => (r.difference || 0) < 0).length;
    const surplusCount = rows.filter((r) => (r.difference || 0) > 0).length;
    const matchedCount = rows.filter((r) => (r.difference || 0) === 0).length;
    const varianceVal = rows.reduce((s, r) => s + (r.differenceValue || 0), 0);
    const lossVal = rows.reduce(
      (s, r) => ((r.differenceValue || 0) < 0 ? s + Math.abs(r.differenceValue || 0) : s),
      0
    );

    const html = buildAuditPrintableReportHtml({
      title: t('audit_report_title'),
      subtitle: t('audit_report_subtitle'),
      dateStr: new Date(audit.created_at).toLocaleString(tr(language, 'fr-FR', 'en-US', 'nl-NL')),
      auditorName: audit.auditor_name,
      depotLabel: audit.depot_name,
      auditId: audit.id,
      rows,
      stats: {
        totalTheoreticalCount: audit.items_counted || rows.length,
        countedCount: audit.items_counted || rows.length,
        matchedCount,
        missingCount,
        surplusCount,
        uncountedCount: 0,
        theoreticalVal: 0,
        physicalVal: 0,
        varianceVal,
        lossVal,
        progressPct: 100,
        accuracyRate:
          rows.length > 0 ? Math.round((matchedCount / Math.max(1, rows.length)) * 100) : 100,
      },
      canViewPrices,
      sigAuditorLabel: t('audit_report_sig_auditor'),
      sigManagerLabel: t('audit_report_sig_manager'),
    });
    printHtmlDocument(html);
  };

  if (!canAudit) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        {tr(
          language,
          'Accès restreint : la permission perm_menu_inventory_audit est requise.',
          'Restricted access: permission perm_menu_inventory_audit is required.',
          'Beperkte toegang: machtiging perm_menu_inventory_audit is vereist.'
        )}
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      {/* En-tête de la page Audit Bureau + Onglets */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
            <ClipboardCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-900 dark:text-white">
              {tr(
                language,
                'Audit & Inventaire par dépôt',
                'Audit & Inventory by Depot',
                'Audit & Voorraad per depot'
              )}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {tr(
                language,
                'Matrice multi-dépôts en temps réel, comptage physique isolé par dépôt et historique des audits.',
                'Real-time multi-depot matrix, depot-isolated physical counting and audit history.',
                'Realtime multi-depotmatrix, fysieke telling per depot en auditgeschiedenis.'
              )}
            </p>
          </div>
        </div>

        {/* Sélecteur des 3 vues */}
        <div
          role="tablist"
          className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'matrix'}
            onClick={() => setActiveTab('matrix')}
            className={`px-3 py-2 rounded-lg flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'matrix'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>
              {tr(language, 'Stock par dépôt', 'Stock by depot', 'Voorraad per depot')}
            </span>
            {matrixResult.totalDiscrepancies > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black">
                {matrixResult.totalDiscrepancies}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'counting'}
            onClick={() => setActiveTab('counting')}
            className={`px-3 py-2 rounded-lg flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'counting'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Barcode className="w-3.5 h-3.5" />
            <span>{tr(language, 'Comptage', 'Counting', 'Telling')}</span>
            {Object.keys(counts).length > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-black">
                {Object.keys(counts).length}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'history'}
            onClick={() => {
              setActiveTab('history');
              loadHistory();
            }}
            className={`px-3 py-2 rounded-lg flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'history'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>
              {tr(language, 'Historique des audits', 'Audit history', 'Auditgeschiedenis')}
            </span>
          </button>
        </div>
      </div>

      {/* =====================================================================
          ONGLET 1 : VUE « STOCK PAR DÉPÔT » (MATRICE RÉFÉRENCE × DÉPÔTS)
         ===================================================================== */}
      {activeTab === 'matrix' && (
        <div className="space-y-4">
          {matrixResult.totalDiscrepancies > 0 && (
            <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5 text-rose-800 dark:text-rose-200 font-bold">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>
                  {tr(
                    language,
                    `${matrixResult.totalDiscrepancies} référence(s) présentent un écart de cohérence entre products.quantity et la somme de stock_levels.`,
                    `${matrixResult.totalDiscrepancies} reference(s) have a consistency discrepancy between products.quantity and sum(stock_levels).`,
                    `${matrixResult.totalDiscrepancies} referentie(s) vertonen een consistentieverschil tussen products.quantity en de som van stock_levels.`
                  )}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMatrixDiscrepancyOnly((v) => !v)}
                className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer shrink-0"
              >
                {matrixDiscrepancyOnly
                  ? tr(language, 'Afficher tout', 'Show all', 'Alles tonen')
                  : tr(
                      language,
                      'Filtrer les écarts de cohérence',
                      'Filter discrepancies',
                      'Verschillen filteren'
                    )}
              </button>
            </div>
          )}

          {/* Barre de filtres Matrice */}
          <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2.5 flex-1">
              <div className="relative min-w-[240px] flex-1 max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={matrixSearch}
                  onChange={(e) => setMatrixSearch(e.target.value)}
                  placeholder={tr(
                    language,
                    'Rechercher réf, marque, modèle, code-barres...',
                    'Search ref, brand, model, barcode...',
                    'Zoek ref, merk, model, barcode...'
                  )}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-emerald-500"
                />
              </div>

              <SearchableSelect
                value={matrixCategory}
                onChange={(val) => setMatrixCategory(val)}
                className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold"
              >
                <option value="ALL">
                  {tr(language, 'Toutes les catégories', 'All categories', 'Alle categorieën')}
                </option>
                {subCategories.map((sc) => (
                  <option key={sc.id} value={String(sc.id)}>
                    {sc.name}
                  </option>
                ))}
              </SearchableSelect>

              <SearchableSelect
                value={matrixBrand}
                onChange={(val) => setMatrixBrand(val)}
                className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold"
              >
                <option value="ALL">
                  {tr(language, 'Toutes les marques', 'All brands', 'Alle merken')}
                </option>
                {uniqueBrands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </SearchableSelect>

              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={matrixDiscrepancyOnly}
                  onChange={(e) => setMatrixDiscrepancyOnly(e.target.checked)}
                  className="rounded text-rose-600"
                />
                <span>
                  {tr(
                    language,
                    'Écarts de cohérence uniquement',
                    'Discrepancies only',
                    'Alleen consistentieverschillen'
                  )}
                </span>
              </label>
            </div>

            <button
              type="button"
              onClick={handleExportMatrixCsv}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>{tr(language, 'Exporter CSV', 'Export CSV', 'CSV exporteren')}</span>
            </button>
          </div>

          {/* Tableau Matrice Référence × Dépôts */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="overflow-x-auto max-h-[calc(100vh-290px)]">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-[11px] font-extrabold uppercase text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => toggleMatrixSort('reference')}
                        className="inline-flex items-center gap-1 cursor-pointer hover:text-slate-900 dark:hover:text-white"
                      >
                        <span>{tr(language, 'Référence', 'Reference', 'Referentie')}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => toggleMatrixSort('designation')}
                        className="inline-flex items-center gap-1 cursor-pointer hover:text-slate-900 dark:hover:text-white"
                      >
                        <span>{tr(language, 'Désignation', 'Description', 'Omschrijving')}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => toggleMatrixSort('category')}
                        className="inline-flex items-center gap-1 cursor-pointer hover:text-slate-900 dark:hover:text-white"
                      >
                        <span>{tr(language, 'Catégorie', 'Category', 'Categorie')}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    {matrixResult.depotColumns.map((depotCol) => (
                      <th key={depotCol} className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => toggleMatrixSort(depotCol)}
                          className="inline-flex items-center justify-end gap-1 cursor-pointer hover:text-slate-900 dark:hover:text-white ml-auto"
                        >
                          <Building2 className="w-3 h-3 text-orange-500" />
                          <span>{depotCol}</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                    ))}
                    <th className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => toggleMatrixSort('total')}
                        className="inline-flex items-center justify-end gap-1 cursor-pointer hover:text-slate-900 dark:hover:text-white ml-auto"
                      >
                        <span>{tr(language, 'Total', 'Total', 'Totaal')}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {matrixResult.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4 + matrixResult.depotColumns.length}
                        className="py-10 text-center text-slate-400"
                      >
                        {tr(
                          language,
                          'Aucune référence trouvée pour ces filtres.',
                          'No references found for these filters.',
                          'Geen referenties gevonden voor deze filters.'
                        )}
                      </td>
                    </tr>
                  ) : (
                    matrixResult.rows.map((row) => (
                      <tr
                        key={row.productId}
                        className={
                          row.hasDiscrepancy
                            ? 'bg-rose-50/90 dark:bg-rose-950/35 hover:bg-rose-100/80 dark:hover:bg-rose-950/50'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }
                      >
                        <td className="py-2.5 px-3 font-mono font-bold text-orange-600 dark:text-orange-400 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <ProductRefLink productId={row.productId} reference={row.reference} />
                            {row.hasDiscrepancy && (
                              <span
                                title={tr(
                                  language,
                                  `Écart de cohérence : products.quantity (${row.productQuantity}) ≠ somme des stock_levels (${row.sumOfStockLevels})`,
                                  `Consistency discrepancy: products.quantity (${row.productQuantity}) ≠ sum of stock_levels (${row.sumOfStockLevels})`,
                                  `Consistentieverschil: products.quantity (${row.productQuantity}) ≠ som van stock_levels (${row.sumOfStockLevels})`
                                )}
                                className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black inline-flex items-center gap-1"
                              >
                                <AlertTriangle className="w-2.5 h-2.5" />
                                {tr(language, 'Écart de cohérence', 'Discrepancy', 'Verschil')}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {row.brand} {row.model}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">
                          {row.categoryName}
                        </td>
                        {matrixResult.depotColumns.map((col) => {
                          const qty = row.quantitiesByDepot[col] ?? 0;
                          const rack = row.racksByDepot[col];
                          return (
                            <td
                              key={col}
                              className="py-2.5 px-3 text-right font-mono tabular-nums"
                            >
                              <span
                                className={
                                  qty > 0
                                    ? 'font-bold text-slate-900 dark:text-white'
                                    : 'text-slate-400 dark:text-slate-600'
                                }
                              >
                                {qty}
                              </span>
                              {rack && (
                                <span className="ml-1 text-[10px] text-slate-400">({rack})</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-black text-slate-900 dark:text-white">
                          <span>{row.allowedTotalQuantity}</span>
                          {row.hasDiscrepancy && (
                            <span className="block text-[10px] font-bold text-rose-600 dark:text-rose-400">
                              base={row.productQuantity} / dépôts={row.sumOfStockLevels}
                            </span>
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
      )}

      {/* =====================================================================
          ONGLET 2 : VUE « COMPTAGE » (INVENTAIRE PHYSIQUE PAR DÉPÔT)
         ===================================================================== */}
      {activeTab === 'counting' && (
        <div className="space-y-4">
          {statusBanner && (
            <div
              role="alert"
              className={`p-3.5 rounded-2xl text-xs font-bold flex items-center justify-between gap-2 ${
                statusBanner.type === 'success'
                  ? 'bg-emerald-600 text-white'
                  : statusBanner.type === 'warning'
                  ? 'bg-amber-600 text-white'
                  : 'bg-rose-600 text-white'
              }`}
            >
              <div className="flex items-center gap-2">
                {statusBanner.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                )}
                <span>{statusBanner.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setStatusBanner(null)}
                className="px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 text-[11px] cursor-pointer"
              >
                {tr(language, 'Fermer', 'Close', 'Sluiten')}
              </button>
            </div>
          )}

          {/* Sélection du dépôt, zone, catégorie + Scan USB rapide */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-5 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
              <div className="font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-emerald-600" />
                <span>
                  {tr(
                    language,
                    'Périmètre du comptage (Dépôt / Zone / Catégorie)',
                    'Counting Scope (Depot / Zone / Category)',
                    'Telbereik (Depot / Zone / Categorie)'
                  )}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                    {tr(language, 'Dépôt audité', 'Audited depot', 'Geaudit depot')}
                  </label>
                  <SearchableSelect
                    value={selectedDepot}
                    onChange={(val) => setSelectedDepot(val)}
                    recentKey="depots"
                    className="w-full px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
                  >
                    {allowedDepots.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                    <option value="ALL">
                      {tr(language, 'Tous les dépôts', 'All depots', 'Alle depots')}
                    </option>
                  </SearchableSelect>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                    {tr(language, 'Catégorie', 'Category', 'Categorie')}
                  </label>
                  <SearchableSelect
                    value={selectedCategory}
                    onChange={(val) => setSelectedCategory(val)}
                    className="w-full px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold"
                  >
                    <option value="ALL">
                      {tr(language, 'Toutes', 'All', 'Alle')}
                    </option>
                    {subCategories.map((sc) => (
                      <option key={sc.id} value={String(sc.id)}>
                        {sc.name}
                      </option>
                    ))}
                  </SearchableSelect>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                    {tr(language, 'Zone / Rack', 'Zone / Rack', 'Zone / Rek')}
                  </label>
                  <input
                    type="text"
                    value={zoneQuery}
                    onChange={(e) => setZoneQuery(e.target.value)}
                    placeholder={tr(language, 'Ex: A1, RACK-B...', 'E.g. A1, RACK-B...', 'Bv. A1, RACK-B...')}
                    className="w-full px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Saisie / Douchette USB */}
            <div className="lg:col-span-7 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Barcode className="w-4 h-4 text-emerald-600" />
                  <span>
                    {tr(
                      language,
                      'Douchette USB & Saisie rapide par référence / code-barres',
                      'USB Barcode Scanner & Fast Reference Entry',
                      'USB-barcodescanner & Snelle invoer'
                    )}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setScanMode('ADD')}
                      className={`px-2 py-1 rounded-md cursor-pointer ${
                        scanMode === 'ADD'
                          ? 'bg-white dark:bg-slate-900 text-emerald-600 shadow-2xs'
                          : 'text-slate-500'
                      }`}
                    >
                      {tr(language, '+ Incrémenter', '+ Increment', '+ Verhogen')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setScanMode('SET')}
                      className={`px-2 py-1 rounded-md cursor-pointer ${
                        scanMode === 'SET'
                          ? 'bg-white dark:bg-slate-900 text-emerald-600 shadow-2xs'
                          : 'text-slate-500'
                      }`}
                    >
                      {tr(language, 'Remplacer', 'Replace', 'Vervangen')}
                    </button>
                  </div>

                  <button
                    type="button"
                    data-testid="audit-manual-after-scan"
                    onClick={toggleManualAfterScan}
                    title={tr(
                      language,
                      'Après chaque scan, saisir la quantité comptée au clavier',
                      'After each scan, type the counted quantity',
                      'Typ na elke scan de getelde hoeveelheid'
                    )}
                    className={`px-2 py-1 rounded-lg text-[11px] font-black cursor-pointer border ${
                      manualAfterScan
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-transparent'
                    }`}
                  >
                    ⌨ {tr(language, 'Saisir la quantité', 'Enter quantity', 'Hoeveelheid invoeren')}
                  </button>

                  <div className="flex items-center gap-1">
                    {[1, 5, 10].map((step) => (
                      <button
                        key={step}
                        type="button"
                        onClick={() => setScanStep(step)}
                        className={`px-2 py-1 rounded-lg text-[11px] font-black cursor-pointer ${
                          scanStep === step
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        +{step}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <form onSubmit={handleUsbScanSubmit} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Barcode className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    ref={scanInputRef}
                    type="text"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    placeholder={tr(
                      language,
                      'Scannez un code-barres / QR à la douchette USB ou tapez une référence puis Entrée...',
                      'Scan barcode / QR with USB scanner or type reference then Enter...',
                      'Scan barcode / QR met USB-scanner of typ referentie en druk op Enter...'
                    )}
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono outline-none focus:border-emerald-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!scanInput.trim()}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-extrabold cursor-pointer"
                >
                  {tr(language, 'Valider scan', 'Submit scan', 'Scan bevestigen')}
                </button>
              </form>

              {pendingManualRow && (
                <div className="p-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 flex flex-wrap items-center gap-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="font-extrabold text-slate-800 dark:text-slate-100 truncate">
                      {pendingManualRow.reference} • {pendingManualRow.depotName}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {tr(language, 'Théorique', 'Theoretical', 'Theoretisch')} : <strong>{pendingManualRow.theoreticalQty}</strong>
                      {counts[pendingManualRow.productId] !== undefined && counts[pendingManualRow.productId] !== null && (
                        <> • {tr(language, 'Déjà compté', 'Already counted', 'Reeds geteld')} : <strong>{counts[pendingManualRow.productId]}</strong></>
                      )}
                      {' • '}
                      {scanMode === 'ADD'
                        ? tr(language, 'la quantité saisie s’ajoute', 'typed quantity is added', 'ingevoerde hoeveelheid wordt opgeteld')
                        : tr(language, 'la quantité saisie remplace', 'typed quantity replaces', 'ingevoerde hoeveelheid vervangt')}
                    </div>
                  </div>
                  <input
                    ref={manualQtyInputRef}
                    type="number"
                    min="0"
                    step="1"
                    value={manualQty}
                    onChange={(e) => setManualQty(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        confirmManualQty();
                      }
                    }}
                    placeholder={tr(language, 'Quantité comptée', 'Counted quantity', 'Getelde hoeveelheid')}
                    className="w-40 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 font-mono font-black text-center outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={confirmManualQty}
                    disabled={manualQty.trim() === ''}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-extrabold cursor-pointer"
                  >
                    {tr(language, 'Valider', 'Confirm', 'Bevestigen')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingManualRow(null);
                      setManualQty('');
                      scanInputRef.current?.focus();
                    }}
                    className="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold cursor-pointer"
                  >
                    {tr(language, 'Annuler', 'Cancel', 'Annuleren')}
                  </button>
                </div>
              )}

              {scanFeedback && (
                <div
                  className={`p-2 rounded-xl text-xs font-bold flex items-center gap-2 ${
                    scanFeedback.type === 'error'
                      ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300'
                      : scanFeedback.type === 'warning'
                      ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                      : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                  }`}
                >
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <span>{scanFeedback.text}</span>
                </div>
              )}
            </div>
          </div>

          {/* KPIs de la session de comptage + Actions (Rapport PDF, CSV, Régularisation) */}
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: 'ALL', label: tr(language, 'Tous', 'All', 'Alle'), count: stats.totalTheoreticalCount },
                  { id: 'DIFF_ONLY', label: tr(language, 'Écarts', 'Variances', 'Verschillen'), count: stats.missingCount + stats.surplusCount },
                  { id: 'MATCHED', label: tr(language, 'Conformes', 'Matched', 'Conform'), count: stats.matchedCount },
                  { id: 'MISSING', label: tr(language, 'Manquants', 'Missing', 'Ontbrekend'), count: stats.missingCount },
                  { id: 'SURPLUS', label: tr(language, 'Surplus', 'Surplus', 'Overschot'), count: stats.surplusCount },
                  { id: 'UNCOUNTED', label: tr(language, 'Non comptés', 'Uncounted', 'Ongeteld'), count: stats.uncountedCount },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setTableFilter(f.id)}
                  className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition cursor-pointer ${
                    tableFilter === f.id
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <span>{f.label}</span>
                  <span className="font-mono text-[11px] opacity-80">({f.count})</span>
                </button>
              ))}

              <div className="relative min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={countingSearch}
                  onChange={(e) => setCountingSearch(e.target.value)}
                  placeholder={tr(language, 'Filtrer la liste...', 'Filter list...', 'Lijst filteren...')}
                  className="pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canViewPrices && (
                <div className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-bold">
                  {tr(language, 'Impact écart :', 'Variance value:', 'Waarde verschil:')}{' '}
                  <span
                    className={
                      stats.varianceVal < 0
                        ? 'text-rose-600'
                        : stats.varianceVal > 0
                        ? 'text-blue-600'
                        : 'text-emerald-600'
                    }
                  >
                    {stats.varianceVal >= 0 ? '+' : ''}
                    {formatCurrency(stats.varianceVal)}
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={handleExportCountingCsv}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>CSV</span>
              </button>

              <button
                type="button"
                onClick={handlePrintCurrentSessionReport}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-orange-600" />
                <span>{tr(language, 'Imprimer rapport', 'Print report', 'Rapport afdrukken')}</span>
              </button>

              {Object.keys(counts).length > 0 && (
                <button
                  type="button"
                  onClick={handleResetSession}
                  className="px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-800 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{tr(language, 'Réinitialiser', 'Reset', 'Resetten')}</span>
                </button>
              )}

              {canValidate && (
                <button
                  type="button"
                  disabled={stats.countedCount === 0 || isValidating}
                  onClick={() => setShowValidateConfirm(true)}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-extrabold flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {tr(
                      language,
                      `Valider & Régulariser (${stats.missingCount + stats.surplusCount} écart(s))`,
                      `Validate & Reconcile (${stats.missingCount + stats.surplusCount} variance(s))`,
                      `Valideren & Corrigeren (${stats.missingCount + stats.surplusCount} verschil(len))`
                    )}
                  </span>
                </button>
              )}
            </div>
          </div>

          {showValidateConfirm && (
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="space-y-0.5">
                <div className="font-extrabold text-amber-900 dark:text-amber-200">
                  {tr(
                    language,
                    `Confirmer la régularisation du dépôt « ${selectedDepot} » ?`,
                    `Confirm stock reconciliation for depot "${selectedDepot}"?`,
                    `Voorraadcorrectie bevestigen voor depot "${selectedDepot}"?`
                  )}
                </div>
                <div className="text-amber-700 dark:text-amber-300">
                  {tr(
                    language,
                    `Un mouvement INVENTORY sera exécuté via process_stock_movement pour chacune des ${stats.missingCount + stats.surplusCount} ligne(s) en écart, regroupées sous un identifiant d'audit.`,
                    `An INVENTORY movement will be executed via process_stock_movement for each of the ${stats.missingCount + stats.surplusCount} line(s) with variance, grouped under an audit ID.`,
                    `Er wordt een INVENTORY-beweging uitgevoerd via process_stock_movement voor elk van de ${stats.missingCount + stats.surplusCount} regel(s) met verschil.`
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isValidating}
                  onClick={handleValidateAuditSession}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black cursor-pointer"
                >
                  {isValidating
                    ? tr(language, 'Validation...', 'Validating...', 'Valideren...')
                    : tr(language, 'Confirmer la régularisation', 'Confirm reconciliation', 'Correctie bevestigen')}
                </button>
                <button
                  type="button"
                  onClick={() => setShowValidateConfirm(false)}
                  className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold cursor-pointer"
                >
                  {tr(language, 'Annuler', 'Cancel', 'Annuleren')}
                </button>
              </div>
            </div>
          )}

          {/* Tableau de comptage par dépôt */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="overflow-x-auto max-h-[calc(100vh-370px)]">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-[11px] font-extrabold uppercase text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-2.5 px-3">{tr(language, 'Référence', 'Reference', 'Referentie')}</th>
                    <th className="py-2.5 px-3">{tr(language, 'Désignation', 'Description', 'Omschrijving')}</th>
                    <th className="py-2.5 px-3">{tr(language, 'Dépôt & Rack', 'Depot & Rack', 'Depot & Rek')}</th>
                    <th className="py-2.5 px-3 text-center">
                      {tr(language, 'Théorique (Dépôt)', 'Theoretical (Depot)', 'Theoretisch (Depot)')}
                    </th>
                    <th className="py-2.5 px-3 text-center">
                      {tr(language, 'Quantité comptée', 'Counted qty', 'Getelde hoeveelheid')}
                    </th>
                    <th className="py-2.5 px-3 text-center">
                      {tr(language, 'Écart', 'Variance', 'Verschil')}
                    </th>
                    {canViewPrices && (
                      <th className="py-2.5 px-3 text-right">
                        {tr(language, 'Valeur écart', 'Variance value', 'Waarde verschil')}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={canViewPrices ? 7 : 6} className="py-10 text-center text-slate-400">
                        {tr(
                          language,
                          'Aucun article dans ce périmètre.',
                          'No items in this scope.',
                          'Geen artikelen in dit bereik.'
                        )}
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => (
                      <tr key={`${row.productId}::${row.depotName}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-2.5 px-3 font-mono font-bold text-orange-600 dark:text-orange-400">
                          <ProductRefLink productId={row.productId} reference={row.reference} />
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">
                          {row.brand} {row.model}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {row.depotName}
                          </span>
                          {row.rackLocation && (
                            <span className="ml-1.5 font-mono text-[11px] text-slate-400">
                              ({row.rackLocation})
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-700 dark:text-slate-300">
                          {row.theoreticalQty}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                recordCount(
                                  row,
                                  Math.max(0, (row.countedQty ?? row.theoreticalQty) - 1),
                                  false
                                )
                              }
                              className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 flex items-center justify-center cursor-pointer"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input
                              type="number"
                              min={0}
                              value={row.countedQty !== null ? row.countedQty : ''}
                              placeholder="—"
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '') {
                                  setCounts((curr) => {
                                    const next = { ...curr };
                                    delete next[row.productId];
                                    return next;
                                  });
                                } else {
                                  const num = parseInt(val, 10);
                                  if (!Number.isNaN(num)) {
                                    recordCount(row, Math.max(0, num), false);
                                  }
                                }
                              }}
                              className="w-16 text-center py-1 px-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-bold"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                recordCount(row, (row.countedQty ?? row.theoreticalQty) + 1, false)
                              }
                              className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 flex items-center justify-center cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              title={tr(language, 'Conforme (= théorique)', 'Match theoretical', 'Conform (= theoretisch)')}
                              onClick={() => recordCount(row, row.theoreticalQty, false)}
                              className="px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold text-[10px] cursor-pointer"
                            >
                              = {row.theoreticalQty}
                            </button>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono font-black">
                          {row.difference === null ? (
                            <span className="text-slate-300 dark:text-slate-600">—</span>
                          ) : row.difference === 0 ? (
                            <span className="text-emerald-600">0</span>
                          ) : row.difference > 0 ? (
                            <span className="text-blue-600">+{row.difference}</span>
                          ) : (
                            <span className="text-rose-600">{row.difference}</span>
                          )}
                        </td>
                        {canViewPrices && (
                          <td className="py-2.5 px-3 text-right font-mono font-bold">
                            {row.differenceValue === null ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              <span
                                className={
                                  row.differenceValue < 0
                                    ? 'text-rose-600'
                                    : row.differenceValue > 0
                                    ? 'text-blue-600'
                                    : 'text-emerald-600'
                                }
                              >
                                {row.differenceValue > 0 ? '+' : ''}
                                {formatCurrency(row.differenceValue)}
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          ONGLET 3 : « HISTORIQUE DES AUDITS » (inventory_audits & items)
         ===================================================================== */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {queuedAudits.length > 0 && (
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 space-y-2.5 text-xs">
              <div className="flex items-center gap-2 font-extrabold text-amber-900 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  {tr(
                    language,
                    `Stock régularisé, mais l'historique n'a pas pu être enregistré (${queuedAudits.length} en attente)`,
                    `Stock reconciled, but history could not be saved (${queuedAudits.length} pending)`,
                    `Voorraad gecorrigeerd, maar geschiedenis kon niet worden opgeslagen (${queuedAudits.length} in wachtrij)`
                  )}
                </span>
              </div>
              <div className="space-y-2">
                {queuedAudits.map((op) => {
                  const p = op.payload || {};
                  return (
                    <div
                      key={op.id}
                      className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800/70 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div>
                        <div className="font-bold text-slate-900 dark:text-white">
                          {p.depotName || 'Dépôt'} • {p.auditorName || 'Auditeur'} (
                          {Array.isArray(p.items) ? p.items.length : 0}{' '}
                          {tr(language, 'ligne(s)', 'item(s)', 'regel(s)')})
                        </div>
                        {op.last_error && (
                          <div className="text-[11px] text-rose-600 dark:text-rose-400 font-mono">
                            {op.last_error}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={retryingQueueId === op.id}
                          onClick={() => handleRetryQueuedAudit(String(op.id || ''))}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold cursor-pointer"
                        >
                          {retryingQueueId === op.id
                            ? tr(language, 'Envoi...', 'Sending...', 'Verzenden...')
                            : tr(language, 'Réessayer', 'Retry', 'Opnieuw proberen')}
                        </button>
                        <button
                          type="button"
                          disabled={retryingQueueId === op.id}
                          onClick={() => handleDiscardQueuedAudit(String(op.id || ''))}
                          className="px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-bold cursor-pointer"
                        >
                          {tr(language, 'Abandonner', 'Discard', 'Annuleren')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Liste des audits passés */}
            <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-extrabold uppercase text-slate-500">
                  {tr(language, 'Audits enregistrés', 'Recorded audits', 'Geregistreerde audits')} (
                  {auditHistory.length})
                </h2>
                <button
                  type="button"
                  onClick={loadHistory}
                  className="text-xs font-bold text-emerald-600 hover:underline cursor-pointer"
                >
                  {loadingHistory
                    ? tr(language, 'Chargement...', 'Loading...', 'Laden...')
                    : tr(language, 'Actualiser', 'Refresh', 'Vernieuwen')}
                </button>
              </div>

              {historyError ? (
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 space-y-3 text-xs"
                >
                  <div className="flex items-start gap-2 text-rose-700 dark:text-rose-300 font-bold">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>
                      {tr(
                        language,
                        `Historique illisible : ${historyError}`,
                        `Unreadable history: ${historyError}`,
                        `Geschiedenis onleesbaar: ${historyError}`
                      )}
                    </span>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={loadHistory}
                      className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer"
                    >
                      {tr(language, 'Réessayer', 'Retry', 'Opnieuw proberen')}
                    </button>
                  </div>
                </div>
              ) : auditHistory.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  {tr(
                    language,
                    'Aucun audit enregistré pour le moment.',
                    'No recorded audits yet.',
                    'Nog geen geregistreerde audits.'
                  )}
                </div>
              ) : (
                <div className="space-y-2 max-h-[calc(100vh-260px)] overflow-y-auto pr-1">
                  {auditHistory.map((audit) => {
                    const isSelected = selectedHistoryAudit?.id === audit.id;
                    return (
                      <button
                        key={audit.id}
                        type="button"
                        onClick={() => setSelectedHistoryAuditId(audit.id)}
                        className={`w-full text-left p-3 rounded-xl border transition cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-500'
                            : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-extrabold text-xs text-slate-900 dark:text-white">
                            {audit.depot_name}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">
                            {new Date(audit.created_at).toLocaleString(
                              tr(language, 'fr-FR', 'en-US', 'nl-NL')
                            )}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                          <span>
                            {tr(language, 'Auditeur :', 'Auditor:', 'Auditor:')} {audit.auditor_name}
                          </span>
                          <span className="font-mono font-bold text-orange-600">
                            {audit.items_with_diff} {tr(language, 'écart(s)', 'variance(s)', 'verschil(len)')} /{' '}
                            {audit.items_counted}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

          {/* Détail de l'audit sélectionné */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            {!selectedHistoryAudit ? (
              <div className="py-12 text-center text-xs text-slate-400">
                {tr(
                  language,
                  'Sélectionnez un audit pour afficher son détail.',
                  'Select an audit to view its details.',
                  'Selecteer een audit om de details te bekijken.'
                )}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                  <div>
                    <div className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                      <Eye className="w-4 h-4 text-emerald-600" />
                      <span>{selectedHistoryAudit.depot_name}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      ID: {selectedHistoryAudit.id} • {selectedHistoryAudit.auditor_name}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => handleExportHistoryAuditCsv(selectedHistoryAudit)}
                      className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                      <span>CSV</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReprintHistoryAudit(selectedHistoryAudit)}
                      className="px-3 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>{tr(language, 'Réimprimer', 'Reprint', 'Opnieuw afdrukken')}</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto max-h-[calc(100vh-310px)]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-100 dark:bg-slate-800 text-[11px] font-extrabold uppercase text-slate-500">
                      <tr>
                        <th className="py-2 px-3">{tr(language, 'Référence', 'Reference', 'Referentie')}</th>
                        <th className="py-2 px-3">{tr(language, 'Désignation', 'Description', 'Omschrijving')}</th>
                        <th className="py-2 px-3 text-center">{tr(language, 'Théorique', 'Theoretical', 'Theoretisch')}</th>
                        <th className="py-2 px-3 text-center">{tr(language, 'Compté', 'Counted', 'Geteld')}</th>
                        <th className="py-2 px-3 text-center">{tr(language, 'Écart', 'Variance', 'Verschil')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {(selectedHistoryAudit.items || []).length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-400">
                            {tr(
                              language,
                              'Aucune ligne détaillée enregistrée pour cet audit.',
                              'No detailed rows recorded for this audit.',
                              'Geen gedetailleerde regels geregistreerd voor deze audit.'
                            )}
                          </td>
                        </tr>
                      ) : (
                        selectedHistoryAudit.items.map((it) => (
                          <tr key={it.id}>
                            <td className="py-2 px-3 font-mono font-bold text-orange-600">
                              <ProductRefLink productId={it.product_id} reference={it.product_ref} />
                            </td>
                            <td className="py-2 px-3">{it.product_name || '—'}</td>
                            <td className="py-2 px-3 text-center font-mono">{it.theoretical_qty}</td>
                            <td className="py-2 px-3 text-center font-mono font-bold">
                              {it.physical_count}
                            </td>
                            <td className="py-2 px-3 text-center font-mono font-black">
                              <span
                                className={
                                  it.difference < 0
                                    ? 'text-rose-600'
                                    : it.difference > 0
                                    ? 'text-blue-600'
                                    : 'text-emerald-600'
                                }
                              >
                                {it.difference > 0 ? '+' : ''}
                                {it.difference}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
          </div>
        </div>
      )}
    </div>
  );
};
