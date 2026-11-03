import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { Product } from '../types';
import { formatCurrency, playScanBeep } from '../utils/crypto';
import jsQR from 'jsqr';
import {
  decodeBarcodeFromCanvas,
  openSmartphoneCameraStream,
  prewarmSmartphoneCameraStream,
  attachStreamToVideoElement,
} from '../utils/qrCodeHelper';
import {
  X,
  ClipboardCheck,
  Camera,
  CameraOff,
  Search,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Printer,
  FileSpreadsheet,
  RotateCcw,
  Plus,
  Minus,
  Check,
  Barcode,
  QrCode,
  MapPin,
  Building2,
  Filter,
  Layers,
  Sparkles,
  HelpCircle,
  TrendingDown,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const AUDIT_STORAGE_KEY = 'tot_inventory_audit_session_v1';

export const InventoryAuditModal: React.FC = () => {
  const {
    inventoryAuditModalOpen,
    setInventoryAuditModalOpen,
    products,
    depots,
    subCategories,
    currentUser,
    applyInventoryAdjustments,
    userHasPermission,
    language,
    t,
    inventoryAuditTargetDepot,
  } = useApp();

  const canViewPrices = userHasPermission('perm_prod_view_price');
  const canAudit = userHasPermission('perm_menu_inventory_audit');
  const canValidate = userHasPermission('perm_inventory_validate') || Number(currentUser?.role_id) === 0;

  // Scope filters
  const [selectedDepot, setSelectedDepot] = useState<string>(() => inventoryAuditTargetDepot || 'ALL');

  useEffect(() => {
    if (inventoryAuditTargetDepot) {
      setSelectedDepot(inventoryAuditTargetDepot);
    }
  }, [inventoryAuditTargetDepot]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [tableFilter, setTableFilter] = useState<
    'ALL' | 'DIFF_ONLY' | 'MATCHED' | 'MISSING' | 'SURPLUS' | 'UNCOUNTED'
  >('ALL');

  // Count map: productId -> physicalCount (number | undefined)
  const [counts, setCounts] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(AUDIT_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Scan input & camera states
  const [scanInput, setScanInput] = useState('');
  const [scanStep, setScanStep] = useState<number>(1);
  const [scanMode, setScanMode] = useState<'ADD' | 'SET'>('ADD');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [lastScannedProduct, setLastScannedProduct] = useState<{
    product: Product;
    previousCount: number | null;
    newCount: number;
    diff: number;
    timestamp: number;
  } | null>(null);

  // Status feedback
  const [scanFeedbackMsg, setScanFeedbackMsg] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  // Reconciliation modal confirmation
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyResultMsg, setApplyResultMsg] = useState<string | null>(null);

  // Camera video & canvas references
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const scanCooldownRef = useRef(false);

  // Save session counts to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(counts));
    } catch {
      // Ignore quota errors
    }
  }, [counts]);

  // Clean camera stream on unmount or when modal closes
  const stopCameraStream = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  }, []);

  useEffect(() => {
    if (!inventoryAuditModalOpen) {
      stopCameraStream();
    }
    return () => {
      stopCameraStream();
    };
  }, [inventoryAuditModalOpen, stopCameraStream]);

  // Products within the audit scope
  const scopeProducts = useMemo(() => {
    return products.filter((p) => {
      if (selectedDepot !== 'ALL') {
        const depotName = (p.store_name || '').toLowerCase().trim();
        if (depotName !== selectedDepot.toLowerCase().trim()) return false;
      }
      if (selectedCategory !== 'ALL') {
        if (String(p.sub_category_id) !== selectedCategory) return false;
      }
      return true;
    });
  }, [products, selectedDepot, selectedCategory]);

  // Products filtered for the table
  const filteredProducts = useMemo(() => {
    return scopeProducts.filter((p) => {
      // Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesRef = p.reference.toLowerCase().includes(q);
        const matchesBrand = p.brand.toLowerCase().includes(q);
        const matchesModel = p.model.toLowerCase().includes(q);
        const matchesOem = (p.manufacturer_ref || '').toLowerCase().includes(q);
        const matchesBarcode = (p.barcode || '').toLowerCase().includes(q);
        if (!matchesRef && !matchesBrand && !matchesModel && !matchesOem && !matchesBarcode) {
          return false;
        }
      }

      const isCounted = p.id in counts;
      const physical = isCounted ? counts[p.id] : null;
      const theoretical = p.quantity;
      const diff = physical !== null ? physical - theoretical : null;

      if (tableFilter === 'DIFF_ONLY') {
        return isCounted && diff !== 0;
      }
      if (tableFilter === 'MATCHED') {
        return isCounted && diff === 0;
      }
      if (tableFilter === 'MISSING') {
        return isCounted && diff !== null && diff < 0;
      }
      if (tableFilter === 'SURPLUS') {
        return isCounted && diff !== null && diff > 0;
      }
      if (tableFilter === 'UNCOUNTED') {
        return !isCounted;
      }

      return true;
    });
  }, [scopeProducts, searchQuery, tableFilter, counts]);

  // Pagination for high fluency & instant rendering
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | 'ALL'>(25);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [tableFilter, searchQuery, selectedDepot, selectedCategory]);

  const totalPages = pageSize === 'ALL' ? 1 : Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const paginatedProducts = useMemo(() => {
    if (pageSize === 'ALL') return filteredProducts;
    const start = (currentPage - 1) * pageSize;
    return filteredProducts.slice(start, start + pageSize);
  }, [filteredProducts, currentPage, pageSize]);

  // Global KPIs for the current scope
  const stats = useMemo(() => {
    let totalTheoreticalCount = scopeProducts.length;
    let countedCount = 0;
    let matchedCount = 0;
    let missingCount = 0;
    let surplusCount = 0;
    let uncountedCount = 0;

    let theoreticalVal = 0;
    let physicalVal = 0;
    let varianceVal = 0;
    let lossVal = 0;

    for (const p of scopeProducts) {
      const price = p.unit_price || 0;
      const theo = p.quantity;
      theoreticalVal += theo * price;

      if (p.id in counts) {
        countedCount++;
        const phys = counts[p.id];
        physicalVal += phys * price;
        const diff = phys - theo;
        varianceVal += diff * price;

        if (diff === 0) {
          matchedCount++;
        } else if (diff < 0) {
          missingCount++;
          lossVal += Math.abs(diff) * price;
        } else {
          surplusCount++;
        }
      } else {
        uncountedCount++;
        // If uncounted, for physical valuation we assume unverified (not counted yet)
      }
    }

    const progressPct =
      totalTheoreticalCount > 0 ? Math.round((countedCount / totalTheoreticalCount) * 100) : 0;
    const accuracyRate = countedCount > 0 ? Math.round((matchedCount / countedCount) * 100) : 0;

    return {
      totalTheoreticalCount,
      countedCount,
      matchedCount,
      missingCount,
      surplusCount,
      uncountedCount,
      theoreticalVal,
      physicalVal,
      varianceVal,
      lossVal,
      progressPct,
      accuracyRate,
    };
  }, [scopeProducts, counts]);

  // Count a specific product by id
  const recordCount = useCallback(
    (product: Product, qty: number, isAddition = false) => {
      const prev = counts[product.id] ?? null;
      let newCount = qty;
      if (isAddition && prev !== null) {
        newCount = prev + qty;
      }
      if (newCount < 0) newCount = 0;

      setCounts((curr) => ({
        ...curr,
        [product.id]: newCount,
      }));

      const diff = newCount - product.quantity;
      setLastScannedProduct({
        product,
        previousCount: prev,
        newCount,
        diff,
        timestamp: Date.now(),
      });

      playScanBeep(true);
      setScanFeedbackMsg({
        type: diff === 0 ? 'success' : diff < 0 ? 'warning' : 'success',
        text: `${product.reference} : compté à ${newCount} (Écart: ${diff >= 0 ? '+' : ''}${diff})`,
      });

      setTimeout(() => {
        setScanFeedbackMsg(null);
      }, 2500);
    },
    [counts]
  );

  // Scan handler (text or barcode detected)
  const handleScannedCode = useCallback(
    (codeText: string) => {
      if (scanCooldownRef.current) return;
      const raw = codeText.trim();
      if (!raw) return;

      scanCooldownRef.current = true;
      setTimeout(() => {
        scanCooldownRef.current = false;
      }, 900);

      const target = raw.toLowerCase();
      // Match by exact reference, qr_code, barcode, oem, or id first
      const matched =
        scopeProducts.find((p) => {
          const ref = String(p.reference ?? '').trim().toLowerCase();
          const qr = String(p.qr_code ?? '').trim().toLowerCase();
          const bc = String(p.barcode ?? '').trim().toLowerCase();
          const oem = String(p.manufacturer_ref ?? '').trim().toLowerCase();
          const id = String(p.id ?? '').trim().toLowerCase();
          return (
            ref === target ||
            (qr && qr === target) ||
            (bc && bc === target) ||
            (oem && oem === target) ||
            id === target
          );
        }) ||
        scopeProducts.find((p) => p.reference && raw.includes(String(p.reference)));

      if (!matched) {
        playScanBeep(false);
        setScanFeedbackMsg({
          type: 'error',
          text: `Code introuvable dans le périmètre sélectionné : "${raw}"`,
        });
        setTimeout(() => setScanFeedbackMsg(null), 2500);
        return;
      }

      recordCount(matched, scanStep, scanMode === 'ADD');
      setScanInput('');
    },
    [scopeProducts, recordCount, scanStep, scanMode]
  );

  const handleScannedCodeRef = useRef(handleScannedCode);
  useEffect(() => {
    handleScannedCodeRef.current = handleScannedCode;
  }, [handleScannedCode]);

  // Camera start / stop toggle
  const toggleCamera = () => {
    if (isCameraActive) {
      stopCameraStream();
    } else {
      prewarmSmartphoneCameraStream();
      setIsCameraActive(true);
    }
  };

  useEffect(() => {
    if (!isCameraActive || !inventoryAuditModalOpen) {
      return;
    }

    let isCancelled = false;

    const startAuditCamera = async () => {
      try {
        const stream = await openSmartphoneCameraStream();
        if (isCancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          await attachStreamToVideoElement(videoRef.current, stream);

          const hasNativeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;
          let nativeDetector: any = null;
          if (hasNativeDetector) {
            try {
              nativeDetector = new (window as any).BarcodeDetector({
                formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf'],
              });
            } catch {
              nativeDetector = null;
            }
          }

          const canvas = canvasRef.current || document.createElement('canvas');
          canvasRef.current = canvas;

          const loop = async () => {
            if (isCancelled || !streamRef.current || !videoRef.current) return;
            const video = videoRef.current;

            if (video.readyState >= 2 && video.videoWidth > 0 && canvas && !scanCooldownRef.current) {
              if (nativeDetector) {
                try {
                  const barcodes = await nativeDetector.detect(video);
                  if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                    handleScannedCodeRef.current(barcodes[0].rawValue);
                    animFrameRef.current = requestAnimationFrame(loop);
                    return;
                  }
                } catch {}
              }

              if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
              }

              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

                // 1. Scan QR Code
                const qr = jsQR(imgData.data, imgData.width, imgData.height, {
                  inversionAttempts: 'dontInvert',
                });
                if (qr && qr.data) {
                  handleScannedCodeRef.current(qr.data);
                } else {
                  // 2. Scan 1D Barcode with ZXing fallback
                  const barcode = decodeBarcodeFromCanvas(canvas);
                  if (barcode) {
                    handleScannedCodeRef.current(barcode);
                  }
                }
              }
            }

            animFrameRef.current = requestAnimationFrame(loop);
          };

          animFrameRef.current = requestAnimationFrame(loop);
        }
      } catch (err) {
        console.warn('Erreur ouverture caméra audit:', err);
        setScanFeedbackMsg({
          type: 'error',
          text: tr(language, "Impossible d'accéder à la caméra.", 'Unable to access camera.'),
        });
        setIsCameraActive(false);
      }
    };

    startAuditCamera();

    return () => {
      isCancelled = true;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [isCameraActive, inventoryAuditModalOpen, language]);

  // Reset audit session
  const handleResetSession = () => {
    if (window.confirm(t('audit_confirm_reset'))) {
      setCounts({});
      setLastScannedProduct(null);
      localStorage.removeItem(AUDIT_STORAGE_KEY);
    }
  };

  // Export CSV of variance report
  const handleExportCsv = () => {
    const rows = [
      [
        'Référence',
        'Code-barres',
        'Marque',
        'Modèle',
        'Dépôt',
        'Emplacement',
        'Stock Théorique',
        'Stock Physique',
        'Écart Unités',
        'Prix Unitaire HT',
        'Écart Valeur HT (€)',
        'Statut',
      ],
    ];

    scopeProducts.forEach((p) => {
      const isCounted = p.id in counts;
      const phys = isCounted ? counts[p.id] : '';
      const theo = p.quantity;
      const numDiff = isCounted ? counts[p.id] - theo : null;
      const price = p.unit_price || 0;
      const valDiff = numDiff !== null ? numDiff * price : '';
      const status = numDiff === null
        ? 'Non compté'
        : numDiff === 0
        ? 'Conforme'
        : numDiff < 0
        ? 'Manquant / Perte'
        : 'Surplus';

      rows.push([
        `"${p.reference}"`,
        `"${p.barcode || ''}"`,
        `"${p.brand}"`,
        `"${p.model}"`,
        `"${p.store_name || ''}"`,
        `"${[p.room_name, p.shelf_name].filter(Boolean).join(' - ')}"`,
        String(theo),
        String(phys),
        numDiff !== null ? String(numDiff) : '',
        price.toFixed(2),
        typeof valDiff === 'number' ? valDiff.toFixed(2) : '',
        `"${status}"`,
      ]);
    });

    const csvContent = '\uFEFF' + rows.map((e) => e.join(';')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const nowStr = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `Rapport_Ecarts_Inventaire_${nowStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Generate & Print official PDF variance report
  const handlePrintReport = () => {
    const printIframeId = 'tot-audit-print-iframe';
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

    const dateStr = new Date().toLocaleDateString(tr(language, 'fr-FR', 'en-US', 'nl-NL'), {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const depotLabel =
      selectedDepot === 'ALL'
        ? tr(language, 'Tous les magasins & dépôts', 'All Warehouses')
        : selectedDepot;

    const itemsWithDiff = scopeProducts.filter((p) => p.id in counts && counts[p.id] !== p.quantity);
    const itemsMatched = scopeProducts.filter((p) => p.id in counts && counts[p.id] === p.quantity);
    const itemsUncounted = scopeProducts.filter((p) => !(p.id in counts));

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${t('audit_report_title')} - TOT</title>
        <meta charset="utf-8" />
        <style>
          @page { size: A4 portrait; margin: 12mm 10mm; }
          * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 0;
            color: #0f172a;
            font-size: 10.5px;
            background: #fff;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #ea580c;
            padding-bottom: 10px;
            margin-bottom: 12px;
          }
          .logo-title {
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .logo-badge {
            background: #ea580c;
            color: #fff;
            font-weight: 900;
            font-size: 14px;
            padding: 4px 8px;
            border-radius: 6px;
            letter-spacing: 1px;
          }
          .title {
            font-size: 16px;
            font-weight: 900;
            color: #0f172a;
            margin: 0;
          }
          .subtitle {
            font-size: 10px;
            color: #64748b;
            margin-top: 2px;
          }
          .meta-box {
            text-align: right;
            font-size: 9.5px;
            color: #475569;
          }
          .kpi-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px;
            margin-bottom: 16px;
          }
          .kpi-card {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 8px;
            background: #f8fafc;
          }
          .kpi-label {
            font-size: 8.5px;
            text-transform: uppercase;
            font-weight: 800;
            color: #64748b;
          }
          .kpi-val {
            font-size: 14px;
            font-weight: 900;
            margin-top: 3px;
          }
          .section-title {
            font-size: 12px;
            font-weight: 900;
            color: #0f172a;
            margin: 14px 0 6px 0;
            display: flex;
            justify-content: space-between;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 9.5px;
            margin-bottom: 14px;
          }
          th {
            background-color: #f1f5f9;
            border: 1px solid #cbd5e1;
            padding: 5px 6px;
            text-align: left;
            font-weight: 800;
          }
          td {
            border: 1px solid #e2e8f0;
            padding: 5px 6px;
            vertical-align: middle;
          }
          .badge-diff-neg {
            color: #dc2626;
            font-weight: 800;
          }
          .badge-diff-pos {
            color: #2563eb;
            font-weight: 800;
          }
          .badge-diff-zero {
            color: #16a34a;
            font-weight: 800;
          }
          .signatures {
            margin-top: 24px;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            page-break-inside: avoid;
          }
          .sig-box {
            border: 1px dashed #94a3b8;
            border-radius: 8px;
            height: 75px;
            padding: 8px;
            font-size: 9px;
            color: #64748b;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo-title">
            <span class="logo-badge">TOT</span>
            <div>
              <h1 class="title">${t('audit_report_title')}</h1>
              <div class="subtitle">${t('audit_report_subtitle')}</div>
            </div>
          </div>
          <div class="meta-box">
            <div><strong>${t('audit_report_date')} :</strong> ${dateStr}</div>
            <div><strong>${t('audit_report_auditor')} :</strong> ${currentUser?.name || 'Administrateur'}</div>
            <div><strong>Périmètre :</strong> ${depotLabel}</div>
          </div>
        </div>

        <!-- KPIs Executive Summary -->
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Articles Audités</div>
            <div class="kpi-val">${stats.countedCount} / ${stats.totalTheoreticalCount} (${stats.progressPct}%)</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Taux d'Exactitude</div>
            <div class="kpi-val" style="color: ${stats.accuracyRate >= 85 ? '#16a34a' : '#d97706'}">
              ${stats.accuracyRate}%
            </div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Écarts Identifiés</div>
            <div class="kpi-val" style="color: ${itemsWithDiff.length > 0 ? '#dc2626' : '#16a34a'}">
              ${itemsWithDiff.length} réf. (${stats.missingCount} déficit, ${stats.surplusCount} surplus)
            </div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Impact Financier Net</div>
            <div class="kpi-val" style="color: ${stats.varianceVal < 0 ? '#dc2626' : stats.varianceVal > 0 ? '#2563eb' : '#16a34a'}">
              ${canViewPrices ? `${stats.varianceVal >= 0 ? '+' : ''}${formatCurrency(stats.varianceVal)}` : 'Confidentiel'}
            </div>
          </div>
        </div>

        <!-- Table des écarts prioritaires -->
        <div class="section-title">
          <span>1. Tableau des Écarts & Anomalies constatées (${itemsWithDiff.length})</span>
          ${canViewPrices ? `<span style="font-size: 10px; color: #dc2626; font-weight: normal;">Pertes brutes : -${formatCurrency(stats.lossVal)}</span>` : ''}
        </div>

        ${
          itemsWithDiff.length === 0
            ? '<p style="color: #16a34a; font-weight: 700; margin: 8px 0 16px 0;">✓ Aucun écart constaté sur les articles comptés ! Le stock physique est 100% conforme au stock théorique.</p>'
            : `
            <table>
              <thead>
                <tr>
                  <th style="width: 14%;">Réf. TOT</th>
                  <th style="width: 28%;">Désignation Article</th>
                  <th style="width: 16%;">Emplacement</th>
                  <th style="width: 10%; text-align: center;">Théorique</th>
                  <th style="width: 10%; text-align: center;">Physique</th>
                  <th style="width: 10%; text-align: center;">Écart</th>
                  <th style="width: 12%; text-align: right;">Val. Écart HT</th>
                </tr>
              </thead>
              <tbody>
                ${itemsWithDiff
                  .map((p) => {
                    const phys = counts[p.id];
                    const theo = p.quantity;
                    const diff = phys - theo;
                    const diffVal = diff * (p.unit_price || 0);
                    return `
                      <tr>
                        <td><strong>${p.reference}</strong></td>
                        <td>${p.brand} ${p.model}</td>
                        <td>${p.store_name || ''} ${p.shelf_name ? `(${p.shelf_name})` : ''}</td>
                        <td style="text-align: center;">${theo}</td>
                        <td style="text-align: center; font-weight: 800;">${phys}</td>
                        <td style="text-align: center;" class="${diff < 0 ? 'badge-diff-neg' : 'badge-diff-pos'}">
                          ${diff > 0 ? '+' : ''}${diff}
                        </td>
                        <td style="text-align: right; font-weight: 800;" class="${diffVal < 0 ? 'badge-diff-neg' : 'badge-diff-pos'}">
                          ${canViewPrices ? (diffVal > 0 ? '+' : '') + formatCurrency(diffVal) : '—'}
                        </td>
                      </tr>
                    `;
                  })
                  .join('')}
              </tbody>
            </table>
          `
        }

        <!-- Articles conformes (résumé) -->
        <div class="section-title">
          <span>2. Articles Conformes Vérifiés (${itemsMatched.length})</span>
        </div>
        <div style="font-size: 9px; color: #475569; margin-bottom: 12px;">
          ${
            itemsMatched.length > 0
              ? itemsMatched.map((p) => `<strong>${p.reference}</strong> (${p.quantity} unités)`).join(' • ')
              : 'Aucun article conforme compté à ce stade.'
          }
        </div>

        ${
          itemsUncounted.length > 0
            ? `
            <div class="section-title">
              <span>3. Articles Non Encore Vérifiés (${itemsUncounted.length})</span>
            </div>
            <div style="font-size: 8.5px; color: #94a3b8; margin-bottom: 16px;">
              ${itemsUncounted.map((p) => p.reference).join(', ')}
            </div>
          `
            : ''
        }

        <!-- Signatures & Visas -->
        <div class="signatures">
          <div class="sig-box">
            <strong>${t('audit_report_sig_auditor')}</strong><br/>
            Nom : ${currentUser?.name || 'Administrateur'}<br/>
            Date : ${dateStr.split(' ')[0]}<br/>
            Signature :
          </div>
          <div class="sig-box">
            <strong>${t('audit_report_sig_manager')}</strong><br/>
            Nom : ___________________________<br/>
            Date : ____ / ____ / ________<br/>
            Signature & Cachet :
          </div>
        </div>
      </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      try {
        printIframe.contentWindow?.focus();
        printIframe.contentWindow?.print();
      } catch (err) {
        console.warn('Iframe print error:', err);
        window.print();
      }
    }, 400);
  };

  // Apply Reconciliation to Database
  const handleApplyReconciliation = async () => {
    setIsApplying(true);
    const adjustments = Object.keys(counts).map((prodId) => {
      const p = products.find((item) => item.id === prodId);
      const theo = p ? p.quantity : 0;
      const phys = counts[prodId];
      return {
        productId: prodId,
        physicalCount: phys,
        theoreticalQty: theo,
        difference: phys - theo,
        reason: 'Régularisation Inventaire Physique TOT',
      };
    });

    const res = await applyInventoryAdjustments(adjustments);
    setIsApplying(false);
    setShowApplyConfirm(false);

    if (res.success) {
      setApplyResultMsg(res.message);
      // Clean up session after successful reconciliation
      setCounts({});
      localStorage.removeItem(AUDIT_STORAGE_KEY);
      setTimeout(() => {
        setApplyResultMsg(null);
        setInventoryAuditModalOpen(false);
      }, 2000);
    } else {
      alert("Erreur lors de l'application de la régularisation.");
    }
  };

  // Keyboard shortcut: close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && inventoryAuditModalOpen) {
        setInventoryAuditModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inventoryAuditModalOpen, setInventoryAuditModalOpen]);

  if (!inventoryAuditModalOpen || !canAudit) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setInventoryAuditModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-white dark:bg-slate-900 w-full max-w-5xl rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[94dvh] sm:max-h-[94vh]">
        {/* Header Bar */}
        <div className="p-3 sm:p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-transparent gap-2">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-md shadow-emerald-500/20 font-bold shrink-0">
              <ClipboardCheck className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white leading-tight truncate">
                  {t('audit_modal_title')}
                </h2>
                <span className="text-[9px] sm:text-[10px] font-extrabold uppercase px-1.5 sm:px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shrink-0">
                  Audit En Direct
                </span>
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {t('audit_modal_subtitle')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 z-20">
            {Object.keys(counts).length > 0 && (
              <button
                type="button"
                onClick={handleResetSession}
                title={t('audit_btn_reset')}
                className="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setInventoryAuditModalOpen(false);
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer active:scale-90 shadow-sm shrink-0 border border-slate-200/80 dark:border-slate-700/80"
              title={t('common_close')}
              aria-label="Fermer l'audit"
            >
              <X className="w-5 h-5 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Success Banner if reconciled */}
          {applyResultMsg && (
            <div className="p-3.5 rounded-2xl bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 animate-in fade-in shadow-md">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>{applyResultMsg}</span>
            </div>
          )}

          {/* Top Controls: Scope Filters & Fast Scan Control */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Box 1 & 2: Fast Scan & Camera Box */}
            <div className="lg:col-span-2 p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Barcode className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>{t('audit_scan_title')}</span>
                </span>

                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  {/* Mode: Add or Set */}
                  <div className="flex items-center bg-slate-200 dark:bg-slate-700/60 p-0.5 rounded-xl text-[10px] font-bold">
                    <button
                      type="button"
                      onClick={() => setScanMode('ADD')}
                      className={`px-2 py-1 rounded-lg transition cursor-pointer ${
                        scanMode === 'ADD'
                          ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-2xs'
                          : 'text-slate-500'
                      }`}
                    >
                      + Incrémenter
                    </button>
                    <button
                      type="button"
                      onClick={() => setScanMode('SET')}
                      className={`px-2 py-1 rounded-lg transition cursor-pointer ${
                        scanMode === 'SET'
                          ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-2xs'
                          : 'text-slate-500'
                      }`}
                    >
                      Remplacer
                    </button>
                  </div>

                  {/* Step Buttons */}
                  <div className="flex items-center gap-1">
                    {[1, 5, 10].map((step) => (
                      <button
                        key={step}
                        type="button"
                        onClick={() => setScanStep(step)}
                        className={`w-7 h-6 rounded-lg text-[10px] font-extrabold transition cursor-pointer ${
                          scanStep === step
                            ? 'bg-emerald-600 text-white shadow-2xs'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        +{step}
                      </button>
                    ))}
                  </div>

                  {/* Camera toggle */}
                  <button
                    type="button"
                    onClick={toggleCamera}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                      isCameraActive
                        ? 'bg-rose-500 text-white shadow-xs'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                    }`}
                  >
                    {isCameraActive ? <CameraOff className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
                    <span>{isCameraActive ? t('audit_stop_camera_btn') : t('audit_scan_camera_btn')}</span>
                  </button>
                </div>
              </div>

              {/* Video Camera Live Feed (if active) */}
              {isCameraActive && (
                <div className="relative w-full h-44 rounded-2xl overflow-hidden bg-black border-2 border-emerald-500 shadow-inner flex items-center justify-center">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 border-2 border-dashed border-white/60 m-6 rounded-xl pointer-events-none flex items-center justify-center">
                    <span className="bg-black/60 px-3 py-1 rounded-full text-white text-[10px] font-bold backdrop-blur-xs">
                      {t('audit_camera_active_hint')}
                    </span>
                  </div>
                </div>
              )}

              {/* Scan / Manual Entry Input Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleScannedCode(scanInput);
                }}
                className="flex items-center gap-2 flex-wrap sm:flex-nowrap"
              >
                <div className="relative flex-1 min-w-[160px]">
                  <input
                    type="text"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    placeholder={t('audit_scan_placeholder')}
                    className="w-full py-2.5 pl-9 pr-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono outline-none focus:border-emerald-500 transition shadow-2xs"
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                </div>
                <button
                  type="submit"
                  disabled={!scanInput.trim()}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-extrabold text-xs transition cursor-pointer shadow-xs"
                >
                  Valider
                </button>
              </form>

              {/* Scan Toast Feedback */}
              {scanFeedbackMsg && (
                <div
                  className={`p-2.5 rounded-xl text-xs font-bold flex items-center gap-2 animate-in fade-in duration-150 ${
                    scanFeedbackMsg.type === 'error'
                      ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50'
                      : scanFeedbackMsg.type === 'warning'
                      ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                      : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                  }`}
                >
                  {scanFeedbackMsg.type === 'error' ? (
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  )}
                  <span>{scanFeedbackMsg.text}</span>
                </div>
              )}

              {/* Last Scanned Item Card */}
              {lastScannedProduct && (
                <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center font-bold shrink-0">
                      <Check className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-1.5 flex-wrap">
                        <span className="text-orange-600 dark:text-orange-400">{lastScannedProduct.product.reference}</span>
                        <span className="truncate">• {lastScannedProduct.product.brand} {lastScannedProduct.product.model}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5 flex-wrap">
                        <span>📍 {lastScannedProduct.product.store_name}</span>
                        {lastScannedProduct.product.shelf_name && <span>({lastScannedProduct.product.shelf_name})</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 ml-auto">
                    <div className="text-right">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">Théorique</div>
                      <div className="font-bold text-slate-700 dark:text-slate-300">{lastScannedProduct.product.quantity}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase font-bold">Compté</div>
                      <div className="font-black text-emerald-600 dark:text-emerald-400 text-base">{lastScannedProduct.newCount}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">Écart</div>
                      <div
                        className={`font-black text-sm ${
                          lastScannedProduct.diff === 0
                            ? 'text-emerald-600'
                            : lastScannedProduct.diff < 0
                            ? 'text-rose-600'
                            : 'text-blue-600'
                        }`}
                      >
                        {lastScannedProduct.diff > 0 ? '+' : ''}
                        {lastScannedProduct.diff}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Box 3: Scope Filters & Scope Info */}
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3 flex flex-col justify-between">
              <div>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-2.5">
                  <Filter className="w-4 h-4 text-emerald-500" />
                  <span>{t('audit_scope_title')}</span>
                </span>

                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                      Magasin / Dépôt
                    </label>
                    <select
                      value={selectedDepot}
                      onChange={(e) => setSelectedDepot(e.target.value)}
                      className="w-full p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold outline-none cursor-pointer"
                    >
                      <option value="ALL">{t('audit_scope_all_depots')}</option>
                      {depots.map((d) => (
                        <option key={d.id} value={d.name}>
                          {d.name} {d.is_active === false ? '(Fermé)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                      Catégorie
                    </label>
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="w-full p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold outline-none cursor-pointer"
                    >
                      <option value="ALL">{t('audit_scope_all_cats')}</option>
                      {subCategories.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Scope Metrics */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700/80 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
                <div className="flex justify-between">
                  <span>Articles dans le périmètre :</span>
                  <strong className="text-slate-800 dark:text-slate-200">{scopeProducts.length}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Valeur théorique totale :</span>
                  <strong className="text-slate-800 dark:text-slate-200">{canViewPrices ? formatCurrency(stats.theoreticalVal) : '—'}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* KPI Dashboard Cards Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-xs">
            <div className="p-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                {t('audit_kpi_progress')}
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-black text-slate-800 dark:text-slate-100">
                  {stats.countedCount}
                </span>
                <span className="text-xs text-slate-400">/ {stats.totalTheoreticalCount}</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
                <div
                  className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${stats.progressPct}%` }}
                />
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                {t('audit_kpi_accuracy')}
              </span>
              <div className="text-lg font-black text-emerald-600 dark:text-emerald-400">
                {stats.accuracyRate}%
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">
                {stats.matchedCount} réf. conformes
              </span>
            </div>

            <div className="p-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs">
              <span className="text-[10px] font-bold text-rose-500 uppercase block mb-1">
                {t('audit_kpi_missing')}
              </span>
              <div className="text-lg font-black text-rose-600 dark:text-rose-400">
                {stats.missingCount}
              </div>
              <span className="text-[10px] text-rose-500/80 mt-1 block">
                {canViewPrices ? `Pertes : -${formatCurrency(stats.lossVal)}` : 'Pertes : —'}
              </span>
            </div>

            <div className="p-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs">
              <span className="text-[10px] font-bold text-blue-500 uppercase block mb-1">
                {t('audit_kpi_surplus')}
              </span>
              <div className="text-lg font-black text-blue-600 dark:text-blue-400">
                {stats.surplusCount}
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">Articles en excédent</span>
            </div>

            <div className="p-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                {t('audit_kpi_physical_val')}
              </span>
              <div className="text-base font-black text-slate-800 dark:text-slate-100 truncate">
                {canViewPrices ? formatCurrency(stats.physicalVal) : '—'}
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">Stock compté</span>
            </div>

            <div className="p-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                {t('audit_kpi_variance_val')}
              </span>
              <div
                className={`text-base font-black truncate ${
                  stats.varianceVal < 0
                    ? 'text-rose-600'
                    : stats.varianceVal > 0
                    ? 'text-blue-600'
                    : 'text-emerald-600'
                }`}
              >
                {canViewPrices
                  ? `${stats.varianceVal > 0 ? '+' : ''}${formatCurrency(stats.varianceVal)}`
                  : '—'}
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">Écart net total</span>
            </div>
          </div>

          {/* Interactive Variance Table Section */}
          <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-xs">
            {/* Table Filter Tabs & Search Header */}
            <div className="p-3 border-b border-slate-100 dark:border-slate-700/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => setTableFilter('ALL')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                    tableFilter === 'ALL'
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {t('audit_filter_all')} ({scopeProducts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTableFilter('DIFF_ONLY')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                    tableFilter === 'DIFF_ONLY'
                      ? 'bg-rose-600 text-white'
                      : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100'
                  }`}
                >
                  {t('audit_filter_diff_only')} ({stats.missingCount + stats.surplusCount})
                </button>
                <button
                  type="button"
                  onClick={() => setTableFilter('MISSING')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                    tableFilter === 'MISSING'
                      ? 'bg-rose-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {t('audit_filter_missing')} ({stats.missingCount})
                </button>
                <button
                  type="button"
                  onClick={() => setTableFilter('SURPLUS')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                    tableFilter === 'SURPLUS'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {t('audit_filter_surplus')} ({stats.surplusCount})
                </button>
                <button
                  type="button"
                  onClick={() => setTableFilter('MATCHED')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                    tableFilter === 'MATCHED'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {t('audit_filter_matched')} ({stats.matchedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setTableFilter('UNCOUNTED')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                    tableFilter === 'UNCOUNTED'
                      ? 'bg-amber-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {t('audit_filter_uncounted')} ({stats.uncountedCount})
                </button>
              </div>

              <div className="relative w-full sm:w-64">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filtrer réf, marque..."
                  className="w-full py-1.5 pl-8 pr-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs outline-none"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            {/* Table Content */}
            <div className="overflow-x-auto max-h-[380px]">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-wider sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="p-3">{t('audit_col_item')}</th>
                    <th className="p-3">{t('audit_col_location')}</th>
                    <th className="p-3 text-center">{t('audit_col_theoretical')}</th>
                    <th className="p-3 text-center">{t('audit_col_physical')}</th>
                    <th className="p-3 text-center">{t('audit_col_diff_qty')}</th>
                    <th className="p-3 text-right">{t('audit_col_diff_value')}</th>
                    <th className="p-3 text-center">{t('audit_col_status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 font-sans">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        Aucun article correspondant aux filtres sélectionnés.
                      </td>
                    </tr>
                  ) : (
                    paginatedProducts.map((p) => {
                      const isCounted = p.id in counts;
                      const physical = isCounted ? counts[p.id] : null;
                      const theoretical = p.quantity;
                      const diff = physical !== null ? physical - theoretical : null;
                      const diffVal = diff !== null ? diff * (p.unit_price || 0) : null;

                      return (
                        <tr
                          key={p.id}
                          className={`hover:bg-slate-50 dark:hover:bg-slate-750 transition ${
                            diff !== null && diff !== 0
                              ? diff < 0
                                ? 'bg-rose-50/40 dark:bg-rose-950/20'
                                : 'bg-blue-50/40 dark:bg-blue-950/20'
                              : ''
                          }`}
                        >
                          {/* Item Info */}
                          <td className="p-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-extrabold text-orange-600 dark:text-orange-400">
                                {p.reference}
                              </span>
                              {p.barcode && (
                                <span className="font-mono text-[9px] bg-slate-100 dark:bg-slate-700 px-1 py-0.5 rounded text-slate-500">
                                  {p.barcode}
                                </span>
                              )}
                            </div>
                            <div className="text-slate-800 dark:text-slate-200 font-bold truncate max-w-[200px]">
                              {p.brand} {p.model}
                            </div>
                          </td>

                          {/* Location */}
                          <td className="p-3 text-slate-500 text-[11px]">
                            <div className="font-semibold text-slate-700 dark:text-slate-300">
                              {p.store_name}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {[p.room_name, p.shelf_name].filter(Boolean).join(' • ') || 'Non précisé'}
                            </div>
                          </td>

                          {/* Theoretical Stock */}
                          <td className="p-3 text-center">
                            <span className="font-extrabold text-slate-600 dark:text-slate-400 text-sm">
                              {theoretical}
                            </span>
                          </td>

                          {/* Physical Count with quick controls */}
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => recordCount(p, (counts[p.id] || 0) - 1, false)}
                                className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-600 flex items-center justify-center font-bold cursor-pointer"
                              >
                                <Minus className="w-3 h-3" />
                              </button>

                              <input
                                type="number"
                                min="0"
                                value={isCounted ? counts[p.id] : ''}
                                placeholder="—"
                                onChange={(e) => {
                                  const val = e.target.value.trim() === '' ? 0 : parseInt(e.target.value, 10);
                                  recordCount(p, isNaN(val) ? 0 : val, false);
                                }}
                                className={`w-14 p-1 rounded-lg text-center font-black text-sm outline-none border transition ${
                                  isCounted
                                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 text-emerald-800 dark:text-emerald-300'
                                    : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-400'
                                }`}
                              />

                              <button
                                type="button"
                                onClick={() => recordCount(p, (counts[p.id] || 0) + 1, false)}
                                className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-600 flex items-center justify-center font-bold cursor-pointer"
                              >
                                <Plus className="w-3 h-3" />
                              </button>

                              {/* Quick 0 button (mark empty/out of stock) */}
                              <button
                                type="button"
                                onClick={() => recordCount(p, 0, false)}
                                title={t('audit_mark_zero')}
                                className="px-1.5 h-6 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-rose-100 text-[10px] font-bold text-slate-500 hover:text-rose-600 transition cursor-pointer"
                              >
                                0
                              </button>
                            </div>
                          </td>

                          {/* Variance Qty */}
                          <td className="p-3 text-center">
                            {diff === null ? (
                              <span className="text-slate-400 text-xs">—</span>
                            ) : (
                              <span
                                className={`font-black text-xs px-2 py-0.5 rounded-full inline-block ${
                                  diff === 0
                                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                    : diff < 0
                                    ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                                    : 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                                }`}
                              >
                                {diff > 0 ? `+${diff}` : diff}
                              </span>
                            )}
                          </td>

                          {/* Variance Value */}
                          <td className="p-3 text-right">
                            {diffVal === null || !canViewPrices ? (
                              <span className="text-slate-400 text-xs">—</span>
                            ) : (
                              <span
                                className={`font-extrabold text-xs ${
                                  diffVal === 0
                                    ? 'text-slate-400'
                                    : diffVal < 0
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : 'text-blue-600 dark:text-blue-400'
                                }`}
                              >
                                {diffVal > 0 ? `+${formatCurrency(diffVal)}` : formatCurrency(diffVal)}
                              </span>
                            )}
                          </td>

                          {/* Status Badge */}
                          <td className="p-3 text-center">
                            {diff === null ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500">
                                {t('audit_status_uncounted')}
                              </span>
                            ) : diff === 0 ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                {t('audit_status_matched')}
                              </span>
                            ) : diff < 0 ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 border border-rose-500/20">
                                {t('audit_status_missing')}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20">
                                {t('audit_status_surplus')}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination & Display Controls Toolbar */}
            {filteredProducts.length > 0 && (
              <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="text-slate-500 dark:text-slate-400 text-[11px] font-medium flex items-center gap-2">
                  <span>
                    Affichage {pageSize === 'ALL' ? '1' : (currentPage - 1) * pageSize + 1} -{' '}
                    {pageSize === 'ALL' ? filteredProducts.length : Math.min(currentPage * pageSize, filteredProducts.length)} sur{' '}
                    <strong className="text-slate-800 dark:text-slate-200">{filteredProducts.length}</strong> articles
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Page Size Selector */}
                  <div className="flex items-center gap-1 text-[11px] flex-wrap">
                    <span className="text-slate-400 font-bold uppercase text-[9px]">Lignes :</span>
                    {[25, 50, 100].map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => {
                          setPageSize(sz);
                          setCurrentPage(1);
                        }}
                        className={`px-2 py-0.5 rounded-md font-bold transition cursor-pointer ${
                          pageSize === sz
                            ? 'bg-emerald-600 text-white shadow-2xs'
                            : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        {sz}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setPageSize('ALL');
                        setCurrentPage(1);
                      }}
                      className={`px-2 py-0.5 rounded-md font-bold transition cursor-pointer ${
                        pageSize === 'ALL'
                          ? 'bg-emerald-600 text-white shadow-2xs'
                          : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      Tout
                    </button>
                  </div>

                  {/* Prev / Next buttons */}
                  {pageSize !== 'ALL' && totalPages > 1 && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={currentPage <= 1}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        className="p-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 hover:bg-slate-100 transition cursor-pointer"
                        title="Page précédente"
                      >
                        <ChevronLeft className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                      </button>
                      <span className="px-2 font-bold text-slate-700 dark:text-slate-200 text-xs">
                        {currentPage} / {totalPages}
                      </span>
                      <button
                        type="button"
                        disabled={currentPage >= totalPages}
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        className="p-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 hover:bg-slate-100 transition cursor-pointer"
                        title="Page suivante"
                      >
                        <ChevronRight className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action Footer Bar */}
        <div className="p-3 sm:p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            <strong>{stats.countedCount}</strong> sur <strong>{stats.totalTheoreticalCount}</strong> articles vérifiés
            {stats.missingCount + stats.surplusCount > 0 && (
              <span className="text-rose-600 dark:text-rose-400 font-bold ml-1.5">
                • {stats.missingCount + stats.surplusCount} écart(s) détecté(s)
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 w-full sm:w-auto">
            {/* Close modal button */}
            <button
              type="button"
              onClick={() => setInventoryAuditModalOpen(false)}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer active:scale-95"
            >
              {t('common_close')}
            </button>
            {/* Export CSV */}
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>{t('audit_btn_export_csv')}</span>
            </button>

            {/* Print / PDF Official Report */}
            <button
              type="button"
              onClick={handlePrintReport}
              className="px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              <Printer className="w-4 h-4 text-orange-500" />
              <span>{t('audit_btn_export_pdf')}</span>
            </button>

            {/* Reconcile Database Stock : Règle PDF Chap 5 - Séparation entre celui qui compte et celui qui valide les écarts */}
            {canValidate ? (
              <button
                type="button"
                disabled={Object.keys(counts).length === 0}
                onClick={() => setShowApplyConfirm(true)}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-40 text-white font-black text-xs flex items-center gap-2 shadow-md shadow-emerald-600/20 transition active:scale-95 cursor-pointer"
              >
                <ClipboardCheck className="w-4 h-4" />
                <span>{t('audit_btn_apply_stock')}</span>
              </button>
            ) : (
              <div
                className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 text-[11px] font-bold flex items-center gap-1.5"
                title={tr(language, 'Validation des écarts réservée aux responsables habilités', 'Discrepancy validation reserved for managers')}
              >
                <span>🔒 {tr(language, 'Comptage seul (Validation par responsable)', 'Count only (Validation reserved)')}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Dialog for Stock Reconciliation */}
      {showApplyConfirm && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 max-w-md w-full shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center font-bold">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                {t('audit_confirm_apply_title')}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                {t('audit_confirm_apply_msg')}
              </p>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Articles en écart à régulariser :</span>
                <strong>{stats.missingCount + stats.surplusCount}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Impact financier net :</span>
                <strong
                  className={
                    stats.varianceVal < 0
                      ? 'text-rose-600'
                      : stats.varianceVal > 0
                      ? 'text-blue-600'
                      : 'text-emerald-600'
                  }
                >
                  {stats.varianceVal > 0 ? '+' : ''}
                  {formatCurrency(stats.varianceVal)}
                </strong>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isApplying}
                onClick={() => setShowApplyConfirm(false)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 transition cursor-pointer"
              >
                {t('common_cancel')}
              </button>
              <button
                type="button"
                disabled={isApplying}
                onClick={handleApplyReconciliation}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition cursor-pointer shadow-md shadow-emerald-600/20"
              >
                {isApplying ? 'Régularisation...' : 'Confirmer et ajuster'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
