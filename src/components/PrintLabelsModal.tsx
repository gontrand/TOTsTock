import React, { useState, useEffect, useMemo } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { Product } from '../types';
import { formatCurrency } from '../utils/crypto';
import { generateBarcode1DDataUrl, generateQrCodeDataUrlWithTotLogo } from '../utils/qrCodeHelper';
import {
  ModalLabelFormat,
  renderProductLabelsSheetHtml,
  buildFullPrintableDocumentHtml,
  triggerDirectBrowserPrint,
} from '../services/labelRendering';
import {
  DesktopPrinterInfo,
  getDesktopPrintSettings,
  isDesktopApp,
  listDesktopPrinters,
  setDesktopPrintSettings,
} from '../services/desktopBridge';
import { dispatchStationPrintDocument } from '../services/printStationService';
import {
  X,
  Printer,
  Grid,
  FileText,
  Sliders,
  CheckSquare,
  Square,
  Search,
  Plus,
  Minus,
  Barcode,
  QrCode,
  Tag,
  MapPin,
  Building2,
  ChevronDown,
  Download,
  Info,
  CheckCircle2,
} from 'lucide-react';

type LabelFormat = ModalLabelFormat;

interface SelectedProductItem {
  product: Product;
  quantity: number;
}

// Module-level persistent cache across renders & modal re-opens
const GLOBAL_LABEL_IMAGES_CACHE: Record<string, { qr?: string; barcode?: string }> = {};

export const PrintLabelsModal: React.FC = () => {
  const {
    printLabelsModal,
    setPrintLabelsModal,
    products,
    depots,
    subCategories,
    userHasPermission,
    language,
    t,
  } = useApp();

  const canViewPrices = userHasPermission('perm_prod_view_price');

  const [labelFormat, setLabelFormat] = useState<LabelFormat>('avery_3x8');
  const [selectedItems, setSelectedItems] = useState<Map<string, number>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDepot, setFilterDepot] = useState('ALL');
  const [filterCategory, setFilterCategory] = useState('ALL');

  // Options toggles
  const [showQr, setShowQr] = useState(true);
  const [showBarcode, setShowBarcode] = useState(true);
  const [showLocation, setShowLocation] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [showOem, setShowOem] = useState(true);

  const effectiveShowPrice = canViewPrices && showPrice;

  // Cached generated images: key -> { qrUrl, barcodeUrl }
  const [imagesCache, setImagesCache] = useState<Record<string, { qr?: string; barcode?: string }>>(() => ({
    ...GLOBAL_LABEL_IMAGES_CACHE,
  }));
  const [isGenerating, setIsGenerating] = useState(false);
  const [printNotice, setPrintNotice] = useState<string | null>(null);

  const isDesktop = isDesktopApp();
  const [desktopPrinters, setDesktopPrinters] = useState<DesktopPrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>('');
  const [silentPrint, setSilentPrint] = useState<boolean>(true);

  useEffect(() => {
    if (!printLabelsModal.open || !isDesktop) return;
    let active = true;
    Promise.all([listDesktopPrinters(), getDesktopPrintSettings()]).then(([printers, settings]) => {
      if (!active) return;
      setDesktopPrinters(printers);
      setSilentPrint(settings.silent);
      const chosen =
        settings.printerName && printers.some((p) => p.name === settings.printerName)
          ? settings.printerName
          : printers.find((p) => p.isDefault)?.name || printers[0]?.name || settings.printerName || '';
      setSelectedPrinter(chosen);
    });
    return () => {
      active = false;
    };
  }, [printLabelsModal.open, isDesktop]);

  // When modal opens with initialProductId or fresh state
  useEffect(() => {
    if (printLabelsModal.open) {
      if (printLabelsModal.initialProductId) {
        setSelectedItems(new Map([[printLabelsModal.initialProductId, 1]]));
      } else {
        setSelectedItems((prev) => {
          if (prev.size > 0) return prev;
          const map = new Map<string, number>();
          products.slice(0, 12).forEach((p) => {
            map.set(p.id, 1);
          });
          return map;
        });
      }
    }
  }, [printLabelsModal.open, printLabelsModal.initialProductId]);

  // Filtered products list
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (filterDepot !== 'ALL' && (p.store_name || '').toLowerCase() !== filterDepot.toLowerCase()) {
        return false;
      }
      if (filterCategory !== 'ALL' && String(p.sub_category_id) !== filterCategory) {
        return false;
      }
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
      return true;
    });
  }, [products, filterDepot, filterCategory, searchQuery]);

  // List of items to print (flattened with quantities)
  const itemsToPrint = useMemo(() => {
    const list: Product[] = [];
    selectedItems.forEach((qty, prodId) => {
      const prod = products.find((p) => p.id === prodId);
      if (prod && qty > 0) {
        for (let i = 0; i < qty; i++) {
          list.push(prod);
        }
      }
    });
    return list;
  }, [selectedItems, products]);

  // Max items displayed in interactive preview to keep DOM ultra-fluid
  const maxPreviewCount = labelFormat === 'avery_3x8' ? 24 : labelFormat === 'avery_2x7' ? 14 : labelFormat === 'thermal' ? 12 : 25;
  const previewItems = useMemo(() => {
    return itemsToPrint.slice(0, maxPreviewCount);
  }, [itemsToPrint, maxPreviewCount]);

  // Pre-generate QR and Barcode data URLs for items to print with batching & global cache
  useEffect(() => {
    if (!printLabelsModal.open || itemsToPrint.length === 0) return;

    let isMounted = true;
    const uniqueProducts = Array.from(new Set(itemsToPrint));

    // Check which items are missing from cache
    const missingBarcode = showBarcode
      ? uniqueProducts.filter((p) => !GLOBAL_LABEL_IMAGES_CACHE[p.id]?.barcode)
      : [];
    const missingQr = showQr
      ? uniqueProducts.filter((p) => !GLOBAL_LABEL_IMAGES_CACHE[p.id]?.qr)
      : [];

    // Immediately sync state with global cache
    setImagesCache({ ...GLOBAL_LABEL_IMAGES_CACHE });

    if (missingBarcode.length === 0 && missingQr.length === 0) {
      setIsGenerating(false);
      return;
    }

    setIsGenerating(true);

    const generateImages = async () => {
      // 1. Generate barcodes synchronously (fast)
      for (const prod of missingBarcode) {
        if (!GLOBAL_LABEL_IMAGES_CACHE[prod.id]) {
          GLOBAL_LABEL_IMAGES_CACHE[prod.id] = {};
        }
        const barcodeVal = prod.barcode || prod.reference;
        const bc = generateBarcode1DDataUrl(barcodeVal, {
          width: 1.4,
          height: 38,
          displayValue: true,
        });
        if (bc) {
          GLOBAL_LABEL_IMAGES_CACHE[prod.id].barcode = bc;
        }
      }

      if (isMounted) {
        setImagesCache({ ...GLOBAL_LABEL_IMAGES_CACHE });
      }

      // 2. Generate QRs in small batches of 3 so the UI stays responsive
      for (let i = 0; i < missingQr.length; i += 3) {
        if (!isMounted) break;
        const batch = missingQr.slice(i, i + 3);
        await Promise.all(
          batch.map(async (prod) => {
            if (!GLOBAL_LABEL_IMAGES_CACHE[prod.id]) {
              GLOBAL_LABEL_IMAGES_CACHE[prod.id] = {};
            }
            try {
              const qrPayload = (prod.qr_code || prod.reference || '').trim();
              const qr = await generateQrCodeDataUrlWithTotLogo(qrPayload, { size: 180, margin: 1 });
              GLOBAL_LABEL_IMAGES_CACHE[prod.id].qr = qr;
            } catch (e) {
              console.error('Failed to generate QR for product', prod.reference, e);
            }
          })
        );
        if (isMounted) {
          setImagesCache({ ...GLOBAL_LABEL_IMAGES_CACHE });
        }
      }

      if (isMounted) {
        setIsGenerating(false);
      }
    };

    generateImages();

    return () => {
      isMounted = false;
    };
  }, [printLabelsModal.open, itemsToPrint, showQr, showBarcode]);

  // Keyboard shortcut: close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && printLabelsModal.open) {
        setPrintLabelsModal({ open: false });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [printLabelsModal.open, setPrintLabelsModal]);

  if (!printLabelsModal.open) return null;

  // Toggle single product selection
  const handleToggleProduct = (prodId: string) => {
    setSelectedItems((prev) => {
      const next = new Map(prev);
      if (next.has(prodId)) {
        next.delete(prodId);
      } else {
        next.set(prodId, 1);
      }
      return next;
    });
  };

  // Change product quantity
  const handleQuantityChange = (prodId: string, delta: number) => {
    setSelectedItems((prev) => {
      const next = new Map(prev);
      const cur = next.get(prodId) || 0;
      const updated = Math.max(0, cur + delta);
      if (updated === 0) {
        next.delete(prodId);
      } else {
        next.set(prodId, updated);
      }
      return next;
    });
  };

  // Select all / Deselect all filtered
  const handleSelectAllFiltered = () => {
    setSelectedItems((prev) => {
      const next = new Map(prev);
      filteredProducts.forEach((p) => {
        if (!next.has(p.id)) next.set(p.id, 1);
      });
      return next;
    });
  };

  const handleDeselectAllFiltered = () => {
    setSelectedItems((prev) => {
      const next = new Map(prev);
      filteredProducts.forEach((p) => {
        next.delete(p.id);
      });
      return next;
    });
  };

  // Generate complete standalone HTML sheet with full CSS via shared labelRendering.ts
  const getFullPrintableHtml = () => {
    let sheetContent = '';
    const printArea = document.getElementById('tot-printable-sheet');
    if (printArea && printArea.innerHTML.trim() && itemsToPrint.length <= previewItems.length) {
      sheetContent = printArea.innerHTML;
    } else if (itemsToPrint.length > 0) {
      sheetContent = renderProductLabelsSheetHtml(itemsToPrint, {
        format: labelFormat,
        showQr,
        showBarcode,
        showLocation,
        showPrice,
        showOem,
        canViewPrices,
        locale: tr(language, 'fr-FR', 'en-US', 'nl-NL'),
        imagesCache,
      });
    }

    if (!sheetContent) return '';
    return buildFullPrintableDocumentHtml(
      sheetContent,
      labelFormat,
      tr(language, "Planche d'Étiquettes TOT Stock PRO", 'TOT Labels Printing')
    );
  };

  // Export to HTML / PDF with direct clean file download (no popups)
  const handleExportPdf = () => {
    const fullHtml = getFullPrintableHtml();
    if (!fullHtml) return;

    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    // Direct download file
    const a = document.createElement('a');
    a.href = url;
    a.download = `Planche_Etiquettes_${labelFormat}_${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    setPrintNotice(
      tr(
        language,
        '✅ Fichier planche téléchargé avec succès ! Ouvrez-le pour imprimer ou enregistrer au format PDF.',
        '✅ Labels sheet downloaded! Open it to print or save as PDF.'
      )
    );
    setTimeout(() => setPrintNotice(null), 5000);
  };

  // Direct printing: uses Electron desktopBridge.printLabel on desktop or triggerDirectBrowserPrint on web
  const handlePrint = async () => {
    const fullHtml = getFullPrintableHtml();
    if (!fullHtml) {
      handleExportPdf();
      return;
    }

    setPrintNotice(
      isDesktop
        ? tr(
            language,
            `Impression en cours sur « ${selectedPrinter || 'imprimante par défaut'} »...`,
            `Printing on "${selectedPrinter || 'default printer'}"...`,
            `Afdrukken op "${selectedPrinter || 'standaardprinter'}"...`
          )
        : tr(
            language,
            "Lancement de l'impression... Sélectionnez votre imprimante ou « Enregistrer au format PDF ».",
            'Printing launched... Select your printer or "Save as PDF".'
          )
    );

    const res = isDesktop
      ? await dispatchStationPrintDocument({
          html: fullHtml,
          format: labelFormat,
          copies: 1,
          printerName: selectedPrinter,
          silent: silentPrint,
        })
      : await triggerDirectBrowserPrint(fullHtml);

    if (res.ok) {
      if (isDesktop) {
        setPrintNotice(
          tr(
            language,
            '✅ Impression envoyée avec succès à l’imprimante.',
            '✅ Print job sent to printer.',
            '✅ Afdruktaak succesvol verzonden naar printer.'
          )
        );
        setTimeout(() => setPrintNotice(null), 3500);
      } else {
        setPrintNotice(null);
      }
    } else {
      setPrintNotice(res.error || null);
      if (!isDesktop) {
        handleExportPdf();
      }
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setPrintLabelsModal({ open: false });
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/75 backdrop-blur-xs animate-in fade-in duration-200 print-labels-modal-backdrop"
    >
      <div className="bg-white dark:bg-slate-900 w-full max-w-4xl rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[94dvh] sm:max-h-[92vh] print-labels-modal-box">
        {/* Header */}
        <div className="p-3 sm:p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-gradient-to-r from-orange-500/10 via-amber-500/10 to-transparent gap-2 print-labels-header">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-orange-500/15 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0">
              <Printer className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5 sm:gap-2 truncate">
                <span className="truncate">{t('print_labels_title')}</span>
                <span className="text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded-full font-bold bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 shrink-0">
                  {itemsToPrint.length} {t('print_selected_count')}
                </span>
              </h2>
              <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {t('print_labels_subtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 z-20">
            <button
              onClick={handleExportPdf}
              disabled={itemsToPrint.length === 0}
              className="px-2.5 sm:px-3.5 py-1.5 rounded-xl bg-orange-100 dark:bg-orange-950/60 hover:bg-orange-200 dark:hover:bg-orange-900/60 text-orange-800 dark:text-orange-200 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 shadow-xs"
              title="Télécharger la planche d'étiquettes prête pour impression PDF A4"
            >
              <Download className="w-3.5 h-3.5 text-orange-600" />
              <span className="hidden sm:inline">{tr(language, 'Exporter en PDF (A4)', 'Export PDF (A4)')}</span>
              <span className="sm:hidden font-bold">PDF</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPrintLabelsModal({ open: false });
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer active:scale-90 shadow-sm shrink-0 border border-slate-200/80 dark:border-slate-700/80"
              title={t('common_close')}
              aria-label="Fermer"
            >
              <X className="w-5 h-5 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Print Notice Banner */}
        {printNotice && (
          <div className="mx-4 mt-3 p-3 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 rounded-2xl text-xs flex items-center gap-2.5 animate-pulse shadow-sm">
            <Printer className="w-4 h-4 text-blue-600 shrink-0" />
            <span>{printNotice}</span>
          </div>
        )}

        {/* Content Body: Split View (Settings & Selection on left, Real Preview on right) */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-100 dark:divide-slate-800 print-labels-body-grid">
          {/* LEFT COLUMN: Controls & Product Selection (5 cols) */}
          <div className="md:col-span-5 p-3 sm:p-4 space-y-3.5 sm:space-y-4 md:overflow-y-auto md:max-h-[70vh] print-labels-controls">
            {/* Format Selection */}
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1.5 flex items-center gap-1.5">
                <Grid className="w-3.5 h-3.5 text-orange-500" />
                <span>Format de planche / Étiquette</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setLabelFormat('avery_3x8')}
                  className={`p-2.5 rounded-xl border text-left text-xs transition cursor-pointer ${
                    labelFormat === 'avery_3x8'
                      ? 'border-orange-500 bg-orange-50/70 dark:bg-orange-950/40 text-orange-900 dark:text-orange-200 font-extrabold shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="font-bold flex items-center gap-1">
                    <span>Avery A4 3x8</span>
                    <span className="text-[10px] bg-orange-200 dark:bg-orange-900 px-1 rounded">24 ét.</span>
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">70 x 37 mm (Standard)</div>
                </button>

                <button
                  type="button"
                  onClick={() => setLabelFormat('avery_2x7')}
                  className={`p-2.5 rounded-xl border text-left text-xs transition cursor-pointer ${
                    labelFormat === 'avery_2x7'
                      ? 'border-orange-500 bg-orange-50/70 dark:bg-orange-950/40 text-orange-900 dark:text-orange-200 font-extrabold shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="font-bold flex items-center gap-1">
                    <span>Avery A4 2x7</span>
                    <span className="text-[10px] bg-orange-200 dark:bg-orange-900 px-1 rounded">14 ét.</span>
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">105 x 42 mm (Grandes)</div>
                </button>

                <button
                  type="button"
                  onClick={() => setLabelFormat('thermal')}
                  className={`p-2.5 rounded-xl border text-left text-xs transition cursor-pointer ${
                    labelFormat === 'thermal'
                      ? 'border-orange-500 bg-orange-50/70 dark:bg-orange-950/40 text-orange-900 dark:text-orange-200 font-extrabold shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="font-bold">Rouleau Thermique</div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">50 x 30 mm (Zebra/Dymo)</div>
                </button>

                <button
                  type="button"
                  onClick={() => setLabelFormat('catalog')}
                  className={`p-2.5 rounded-xl border text-left text-xs transition cursor-pointer ${
                    labelFormat === 'catalog'
                      ? 'border-orange-500 bg-orange-50/70 dark:bg-orange-950/40 text-orange-900 dark:text-orange-200 font-extrabold shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="font-bold">Fiche A4 Inventaire</div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Listing avec QR Codes</div>
                </button>

                <button
                  type="button"
                  onClick={() => setLabelFormat('bin_rack')}
                  className={`p-2.5 rounded-xl border text-left text-xs transition cursor-pointer col-span-2 sm:col-span-1 ${
                    labelFormat === 'bin_rack'
                      ? 'border-orange-500 bg-orange-50/70 dark:bg-orange-950/40 text-orange-900 dark:text-orange-200 font-extrabold shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="font-bold flex items-center gap-1">
                    <span>Casiers & Bacs</span>
                    <span className="text-[10px] bg-orange-200 dark:bg-orange-900 px-1 rounded">Drive</span>
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">90 x 50 mm (Étagère & Bac)</div>
                </button>
              </div>
            </div>

            {/* Desktop Printer Selection (only in Electron Desktop App) */}
            {isDesktop && (
              <div className="p-3 bg-orange-50/70 dark:bg-orange-950/30 rounded-2xl border border-orange-200 dark:border-orange-900/60 space-y-2.5 text-xs">
                <label className="block font-extrabold text-orange-900 dark:text-orange-200 flex items-center gap-1.5">
                  <Printer className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
                  <span>
                    {tr(
                      language,
                      'Imprimante sélectionnée (Version Bureau)',
                      'Selected Printer (Desktop App)',
                      'Geselecteerde printer (Desktopversie)'
                    )}
                  </span>
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
                <label className="flex items-center gap-2 cursor-pointer select-none">
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
                    className="accent-orange-600 rounded"
                  />
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {tr(
                      language,
                      'Impression silencieuse (sans boîte de dialogue)',
                      'Silent printing (without dialog)',
                      'Stil afdrukken (zonder dialoogvenster)'
                    )}
                  </span>
                </label>
              </div>
            )}

            {/* Display Options Toggles */}
            <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
              <span className="font-bold block text-slate-500 uppercase text-[10px] tracking-wider mb-1">
                Contenu de l'étiquette
              </span>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showQr}
                    onChange={(e) => setShowQr(e.target.checked)}
                    className="accent-orange-600 rounded"
                  />
                  <span>QR Code TOT</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showBarcode}
                    onChange={(e) => setShowBarcode(e.target.checked)}
                    className="accent-orange-600 rounded"
                  />
                  <span>Code-barres 1D</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showLocation}
                    onChange={(e) => setShowLocation(e.target.checked)}
                    className="accent-orange-600 rounded"
                  />
                  <span>Emplacement (Bac)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showOem}
                    onChange={(e) => setShowOem(e.target.checked)}
                    className="accent-orange-600 rounded"
                  />
                  <span>Réf. Fabricant</span>
                </label>
                {canViewPrices && (
                  <label className="flex items-center gap-1.5 cursor-pointer select-none col-span-2">
                    <input
                      type="checkbox"
                      checked={showPrice}
                      onChange={(e) => setShowPrice(e.target.checked)}
                      className="accent-orange-600 rounded"
                    />
                    <span>Prix unitaire HT (€)</span>
                  </label>
                )}
              </div>
            </div>

            {/* Selection Filters */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-300">
                  Sélection des articles ({selectedItems.size}/{products.length})
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAllFiltered}
                    className="text-[10px] text-orange-600 dark:text-orange-400 font-bold hover:underline cursor-pointer"
                  >
                    {t('print_select_all')}
                  </button>
                  <span className="text-slate-300">•</span>
                  <button
                    type="button"
                    onClick={handleDeselectAllFiltered}
                    className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  >
                    {t('print_deselect_all')}
                  </button>
                </div>
              </div>

              {/* Search + Filters row */}
              <div className="space-y-1.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('print_search_placeholder')}
                    className="w-full pl-8 pr-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  <select
                    value={filterDepot}
                    onChange={(e) => setFilterDepot(e.target.value)}
                    className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] outline-none"
                  >
                    <option value="ALL">{t('print_filter_depot')}</option>
                    {depots.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] outline-none"
                  >
                    <option value="ALL">{t('print_filter_cat')}</option>
                    {subCategories.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Product Checkboxes & Quantity Stepper */}
              <div className="max-h-[220px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 text-xs">
                {filteredProducts.length === 0 ? (
                  <div className="p-4 text-center text-slate-400 text-[11px]">
                    Aucune référence trouvée
                  </div>
                ) : (
                  <>
                    {filteredProducts.slice(0, 60).map((p) => {
                      const isChecked = selectedItems.has(p.id);
                      const qty = selectedItems.get(p.id) || 0;

                      return (
                        <div
                          key={p.id}
                          className={`p-2 flex items-center justify-between transition ${
                            isChecked ? 'bg-orange-50/40 dark:bg-orange-950/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <div
                            onClick={() => handleToggleProduct(p.id)}
                            className="flex items-center gap-2 cursor-pointer flex-1 min-w-0 pr-2"
                          >
                            <div className="shrink-0 text-orange-600">
                              {isChecked ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-300" />}
                            </div>
                            <div className="truncate">
                              <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1 truncate">
                                <span className="text-orange-600 font-extrabold">{p.reference}</span>
                                <span className="text-slate-400">•</span>
                                <span className="truncate">{p.brand} {p.model}</span>
                              </div>
                              <div className="text-[10px] text-slate-400 flex items-center gap-2">
                                <span>📍 {p.store_name || 'Dépôt'}</span>
                                {p.barcode && <span>🏷️ {p.barcode}</span>}
                              </div>
                            </div>
                          </div>

                          {/* Quantity Stepper */}
                          {isChecked && (
                            <div className="flex items-center gap-1 shrink-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-0.5 shadow-2xs">
                              <button
                                type="button"
                                onClick={() => handleQuantityChange(p.id, -1)}
                                className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="w-6 text-center font-extrabold text-xs text-orange-600">
                                {qty}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleQuantityChange(p.id, 1)}
                                className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {filteredProducts.length > 60 && (
                      <div className="p-2 text-center text-[10px] text-slate-400 bg-slate-50 dark:bg-slate-800 font-medium">
                        Affichage des 60 premiers articles sur {filteredProducts.length}. Utilisez la recherche ci-dessus pour affiner.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Real Preview & Print Canvas (7 cols) */}
          <div className="md:col-span-7 p-3 sm:p-4 flex flex-col bg-slate-100/60 dark:bg-slate-950/60 overflow-hidden print-labels-preview-pane">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                <span>{t('print_preview_title')}</span>
                {isGenerating && <span className="text-[10px] text-orange-600 animate-pulse">Génération des visuels...</span>}
              </span>
              <span className="text-[10px] sm:text-[11px] text-slate-400">
                {labelFormat === 'avery_3x8' && '3 colonnes × 8 lignes (24 par page A4)'}
                {labelFormat === 'avery_2x7' && '2 colonnes × 7 lignes (14 par page A4)'}
                {labelFormat === 'thermal' && 'Étiquette individuelle 50×30 mm'}
                {labelFormat === 'catalog' && 'Tableau récapitulatif format A4'}
                {labelFormat === 'bin_rack' && 'Casiers & Bacs Drive (Grand format 90×50 mm)'}
              </span>
            </div>

            {/* Scrollable Sheet Preview Container */}
            <div className="flex-1 overflow-x-auto md:overflow-y-auto p-2.5 sm:p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-inner md:max-h-[56vh] print-labels-preview-scroll">
              {itemsToPrint.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center text-slate-400 text-xs">
                  <Printer className="w-8 h-8 mb-2 stroke-1 text-slate-300" />
                  <p>Aucun article sélectionné pour l'impression.</p>
                  <p className="text-[10px] text-slate-400 mt-1">Cochez une ou plusieurs références dans la colonne de gauche.</p>
                </div>
              ) : (
                <div id="tot-printable-sheet">
                  {itemsToPrint.length > previewItems.length && (
                    <div className="mb-2.5 p-2 rounded-xl bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 text-[10px] font-bold border border-orange-200 dark:border-orange-800/60 flex items-center justify-between gap-2">
                      <span>⚡ Aperçu première planche ({previewItems.length} étiquettes affichées)</span>
                      <span className="text-[9px] bg-orange-200/80 dark:bg-orange-900/60 px-1.5 py-0.5 rounded text-orange-900 dark:text-orange-200">
                        {itemsToPrint.length} étiquettes à l'impression
                      </span>
                    </div>
                  )}

                  {/* CATALOG FORMAT */}
                  {labelFormat === 'catalog' && (
                    <div className="p-2 space-y-3">
                      <div className="border-b border-slate-200 pb-2 mb-2">
                        <div className="text-sm font-black text-slate-900">TOT - CATALOGUE D'INVENTAIRE & CODES DE TRAÇABILITÉ</div>
                        <div className="text-[10px] text-slate-500">
                          Date : {new Date().toLocaleDateString(tr(language, 'fr-FR', 'en-US', 'nl-NL'))} • Total articles : {itemsToPrint.length}
                        </div>
                      </div>

                      <table className="catalog-table">
                        <thead>
                          <tr>
                            <th>Réf / Article</th>
                            <th>Code-barres 1D</th>
                            <th>QR Code</th>
                            <th>Emplacement</th>
                            <th>Stock</th>
                            <th>Prix HT</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewItems.map((p, idx) => {
                            const img = imagesCache[p.id];
                            return (
                              <tr key={`${p.id}-${idx}`}>
                                <td>
                                  <div className="font-bold text-orange-600">{p.reference}</div>
                                  <div className="font-extrabold text-slate-900">{p.brand} {p.model}</div>
                                  {p.manufacturer_ref && (
                                    <div className="text-[9px] text-slate-400">OEM: {p.manufacturer_ref}</div>
                                  )}
                                </td>
                                <td>
                                  {img?.barcode ? (
                                    <img src={img.barcode} alt="Barcode" className="barcode-img max-h-6" />
                                  ) : (
                                    <span className="text-slate-400 font-mono text-[9px]">{p.barcode || p.reference}</span>
                                  )}
                                </td>
                                <td>
                                  {img?.qr && (
                                    <img src={img.qr} alt="QR" className="w-10 h-10 object-contain" />
                                  )}
                                </td>
                                <td>
                                  <div className="font-bold">{p.store_name}</div>
                                  <div className="text-[9px] text-slate-500">{p.room_name} &gt; {p.shelf_name}</div>
                                </td>
                                <td className="font-bold text-center">
                                  {p.quantity}
                                </td>
                                <td className="font-bold">
                                  {formatCurrency(p.unit_price)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* AVERY 3x8 GRID (24 labels) */}
                  {labelFormat === 'avery_3x8' && (
                    <div className="grid-avery_3x8">
                      {previewItems.map((p, idx) => {
                        const img = imagesCache[p.id];
                        return (
                          <div key={`${p.id}-${idx}`} className="label-cell">
                            <div className="flex items-start justify-between gap-1">
                              <div className="min-w-0 flex-1">
                                <div className="ref-badge">{p.reference}</div>
                                <div className="title-text">{p.brand} {p.model}</div>
                                {showOem && p.manufacturer_ref && (
                                  <div className="sub-text">OEM: {p.manufacturer_ref}</div>
                                )}
                              </div>
                              {showQr && img?.qr && (
                                <img src={img.qr} alt="QR" className="qr-img" />
                              )}
                            </div>

                            {/* Middle / Barcode */}
                            {showBarcode && img?.barcode && (
                              <div className="my-0.5">
                                <img src={img.barcode} alt="1D Barcode" className="barcode-img" />
                              </div>
                            )}

                            {/* Bottom row */}
                            <div className="flex items-center justify-between text-[8px] text-slate-500 pt-0.5 border-t border-slate-100">
                              {showLocation && (
                                <span className="tag-loc truncate max-w-[120px]">
                                  📍 {p.store_name} &gt; {p.shelf_name || p.room_name}
                                </span>
                              )}
                              {effectiveShowPrice && (
                                <span className="font-black text-slate-800">
                                  {formatCurrency(p.unit_price)}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* AVERY 2x7 GRID (14 large labels) */}
                  {labelFormat === 'avery_2x7' && (
                    <div className="grid-avery_2x7">
                      {previewItems.map((p, idx) => {
                        const img = imagesCache[p.id];
                        return (
                          <div key={`${p.id}-${idx}`} className="label-cell">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-black text-orange-600">{p.reference}</div>
                                <div className="text-xs font-extrabold text-slate-900 truncate">{p.brand} {p.model}</div>
                                {showOem && p.manufacturer_ref && (
                                  <div className="text-[9px] text-slate-500">Réf. Fab: {p.manufacturer_ref}</div>
                                )}
                                {showLocation && (
                                  <div className="tag-loc mt-1">
                                    📍 {p.store_name} • {p.room_name} • {p.shelf_name}
                                  </div>
                                )}
                              </div>
                              {showQr && img?.qr && (
                                <img src={img.qr} alt="QR" className="w-14 h-14 object-contain shrink-0" />
                              )}
                            </div>

                            {/* Barcode */}
                            {showBarcode && img?.barcode && (
                              <div className="my-1 text-center">
                                <img src={img.barcode} alt="1D Barcode" className="barcode-img mx-auto" />
                              </div>
                            )}

                            {/* Bottom row */}
                            <div className="flex items-center justify-between text-[9px] text-slate-600 pt-1 border-t border-slate-100">
                              <span>TOT Inventory</span>
                              {effectiveShowPrice && (
                                <span className="font-bold text-slate-900">
                                  PU HT : {formatCurrency(p.unit_price)}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* THERMAL 50x30 mm */}
                  {labelFormat === 'thermal' && (
                    <div className="grid-thermal">
                      {previewItems.map((p, idx) => {
                        const img = imagesCache[p.id];
                        return (
                          <div key={`${p.id}-${idx}`} className="label-cell">
                            <div className="flex items-start justify-between gap-1">
                              <div className="min-w-0 flex-1">
                                <div className="text-[10px] font-black text-orange-600">{p.reference}</div>
                                <div className="text-[9px] font-extrabold text-slate-900 leading-none truncate">{p.brand} {p.model}</div>
                              </div>
                              {showQr && img?.qr && (
                                <img src={img.qr} alt="QR" className="w-9 h-9 object-contain shrink-0" />
                              )}
                            </div>

                            {showBarcode && img?.barcode && (
                              <img src={img.barcode} alt="1D Barcode" className="barcode-img max-h-5 my-0.5 mx-auto" />
                            )}

                            <div className="flex items-center justify-between text-[7px] text-slate-600">
                              {showLocation && <span>📍 {p.store_name}</span>}
                              {effectiveShowPrice && <span className="font-bold">{formatCurrency(p.unit_price)}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* CASIERS & BACS DE RETRAIT (BIN & RACK) 90x50 mm */}
                  {labelFormat === 'bin_rack' && (
                    <div className="grid-bin_rack">
                      {previewItems.map((p, idx) => {
                        const img = imagesCache[p.id];
                        return (
                          <div key={`${p.id}-${idx}`} className="label-cell">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <span className="inline-block bg-orange-600 text-white font-black text-xs px-2 py-0.5 rounded shadow-2xs">
                                  {p.reference}
                                </span>
                                <div className="text-xs font-black text-slate-900 mt-1 truncate">
                                  {p.brand} {p.model}
                                </div>
                                {showLocation && (
                                  <div className="text-[10px] font-bold text-sky-700 mt-1">
                                    📍 {p.store_name || 'Dépôt'} • {p.shelf_name || p.room_name || 'Casier'}
                                  </div>
                                )}
                                {showOem && p.manufacturer_ref && (
                                  <div className="text-[9px] text-slate-500">
                                    Réf. Fab: {p.manufacturer_ref}
                                  </div>
                                )}
                              </div>
                              {showQr && img?.qr && (
                                <img src={img.qr} alt="QR" className="w-14 h-14 object-contain shrink-0" />
                              )}
                            </div>

                            {showBarcode && img?.barcode && (
                              <div className="my-1 text-center">
                                <img src={img.barcode} alt="1D Barcode" className="barcode-img mx-auto max-h-6" />
                              </div>
                            )}

                            <div className="flex items-center justify-between text-[9px] font-bold text-slate-600 pt-1 border-t border-slate-200">
                              <span>CASIER / BAC MAGASIN</span>
                              {effectiveShowPrice && (
                                <span className="text-slate-900">{formatCurrency(p.unit_price)}</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Footer */}
        <div className="p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 shrink-0">
          <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 text-center sm:text-left">
            <strong>{itemsToPrint.length}</strong> {t('print_selected_count')}
            {labelFormat === 'avery_3x8' && (
              <span> • ~{Math.ceil(itemsToPrint.length / 24)} page(s) A4</span>
            )}
            {labelFormat === 'avery_2x7' && (
              <span> • ~{Math.ceil(itemsToPrint.length / 14)} page(s) A4</span>
            )}
            {labelFormat === 'bin_rack' && (
              <span> • ~{Math.ceil(itemsToPrint.length / 8)} page(s) A4</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap sm:flex-nowrap w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={() => setPrintLabelsModal({ open: false })}
              className="px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              {t('common_cancel')}
            </button>

            <button
              type="button"
              disabled={itemsToPrint.length === 0}
              onClick={handleExportPdf}
              className="flex-1 sm:flex-initial justify-center px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-orange-50 dark:bg-orange-950/60 hover:bg-orange-100 dark:hover:bg-orange-900/60 text-orange-800 dark:text-orange-200 font-extrabold text-xs flex items-center gap-1.5 border border-orange-200 dark:border-orange-800 transition active:scale-95 disabled:opacity-50 cursor-pointer shadow-xs"
              title="Exporter la planche d'étiquettes au format PDF A4 ou HTML"
            >
              <Download className="w-4 h-4 text-orange-600 shrink-0" />
              <span className="truncate">{tr(language, 'Exporter PDF', 'Export PDF')}</span>
            </button>

            <button
              type="button"
              disabled={itemsToPrint.length === 0}
              onClick={handlePrint}
              className="flex-1 sm:flex-initial justify-center px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-md shadow-orange-500/25 transition active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <Printer className="w-4 h-4 shrink-0" />
              <span className="truncate">{t('print_btn_print')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
