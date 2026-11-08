import React, { useEffect, useState } from 'react';
import { Printer, Terminal, X } from 'lucide-react';
import { Product } from '../../types';
import { useApp } from '../../context/AppContext';
import { tr } from '../../i18n/dutchTranslator';
import { SearchableSelect } from '../../components/SearchableSelect';
import {
  CanonicalPrintLabelFormat,
  buildFullPrintableDocumentHtml,
  generateProductVisualsMap,
  renderProductLabelsSheetHtml,
} from '../../services/labelRendering';
import { dispatchStationPrintDocument } from '../../services/printStationService';
import { generateProductZplLabel } from '../../services/zplLabel';
import {
  getDesktopZplSettings,
  isDesktopApp,
  printDesktopZplRaw,
} from '../../services/desktopBridge';

interface DesktopPrintLabelsDialogProps {
  productsToPrint: Product[];
  onClose: () => void;
}

export const DesktopPrintLabelsDialog: React.FC<DesktopPrintLabelsDialogProps> = ({
  productsToPrint,
  onClose,
}) => {
  const { canViewPrices, language } = useApp();
  const [format, setFormat] = useState<CanonicalPrintLabelFormat>('avery_70x37');
  const [copiesPerItem, setCopiesPerItem] = useState(1);
  const [showPrice, setShowPrice] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [printing, setPrinting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function buildPreview() {
      if (productsToPrint.length === 0) return;
      const visuals = await generateProductVisualsMap(productsToPrint, {
        showQr: true,
        showBarcode: true,
      });
      if (cancelled) return;
      const repeated: Product[] = [];
      for (const p of productsToPrint) {
        for (let i = 0; i < Math.max(1, copiesPerItem); i++) {
          repeated.push(p);
        }
      }
      const sheet = renderProductLabelsSheetHtml(repeated, {
        format,
        showQr: true,
        showBarcode: true,
        showLocation: true,
        showOem: true,
        showPrice,
        canViewPrices,
        imagesCache: visuals,
      });
      setPreviewHtml(sheet);
    }
    buildPreview();
    return () => {
      cancelled = true;
    };
  }, [productsToPrint, format, copiesPerItem, showPrice, canViewPrices]);

  if (productsToPrint.length === 0) return null;

  const handleSystemPrint = async () => {
    setPrinting(true);
    setStatusMessage(null);
    try {
      const fullHtml = buildFullPrintableDocumentHtml(
        previewHtml,
        format,
        tr(
          language,
          `Étiquettes TOT Stock (${productsToPrint.length})`,
          `TOT Stock Labels (${productsToPrint.length})`,
          `TOT Stock Etiketten (${productsToPrint.length})`
        )
      );
      const res = await dispatchStationPrintDocument({
        html: fullHtml,
        format,
        copies: 1,
      });
      if (!res.ok) {
        setStatusMessage(
          res.error ||
            tr(
              language,
              "Erreur lors de l'impression",
              'Error while printing',
              'Fout bij het afdrukken'
            )
        );
      } else {
        onClose();
      }
    } finally {
      setPrinting(false);
    }
  };

  const handleZplPrint = async () => {
    setPrinting(true);
    setStatusMessage(null);
    try {
      const zplCfg = await getDesktopZplSettings();
      const blocks = productsToPrint.map((p) =>
        generateProductZplLabel(p, {
          format: zplCfg.format,
          dpi: zplCfg.dpi,
          copies: copiesPerItem,
          offsetXMm: zplCfg.offsetXMm,
          offsetYMm: zplCfg.offsetYMm,
          speed: zplCfg.speed,
          darkness: zplCfg.darkness,
        })
      );
      const res = await printDesktopZplRaw({
        zpl: blocks.join('\n'),
        transport: zplCfg.transport,
        host: zplCfg.host,
        port: zplCfg.port,
        rawPrinterName: zplCfg.rawPrinterName,
      });
      if (!res.ok) {
        setStatusMessage(
          res.errorMessage ||
            tr(language, "Échec de l'envoi ZPL", 'ZPL send failed', 'ZPL-verzending mislukt')
        );
      } else {
        onClose();
      }
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-6">
      <div className="w-full max-w-5xl h-[82vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-black text-slate-900 dark:text-white">
              {tr(
                language,
                `Impression d'étiquettes (${productsToPrint.length} référence(s))`,
                `Print labels (${productsToPrint.length} item(s))`,
                `Etiketten afdrukken (${productsToPrint.length} referentie(s))`
              )}
            </h2>
            <p className="text-xs text-slate-500">
              {tr(
                language,
                'Choisissez le format de planche A4 ou rouleau thermique et prévisualisez avant impression',
                'Choose the A4 sheet or thermal roll format and preview before printing',
                'Kies het A4-vel- of thermische rolformaat en bekijk een voorbeeld voor het afdrukken'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-12 divide-x divide-slate-200 dark:divide-slate-800">
          <div className="col-span-4 p-5 space-y-4 text-xs overflow-y-auto">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                {tr(language, "Format d'étiquette", 'Label format', 'Etiketformaat')}
              </label>
              <SearchableSelect
                value={format}
                onChange={(val) => setFormat(val as CanonicalPrintLabelFormat)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
              >
                <option value="avery_70x37">
                  {tr(
                    language,
                    'Planche A4 Avery 70 × 37 mm (24/page)',
                    'A4 Sheet Avery 70 × 37 mm (24/page)',
                    'A4-vel Avery 70 × 37 mm (24/pagina)'
                  )}
                </option>
                <option value="avery_105x42">
                  {tr(
                    language,
                    'Planche A4 Avery 105 × 42 mm (14/page)',
                    'A4 Sheet Avery 105 × 42 mm (14/page)',
                    'A4-vel Avery 105 × 42 mm (14/pagina)'
                  )}
                </option>
                <option value="thermal_50x30">
                  {tr(
                    language,
                    'Rouleau thermique 50 × 30 mm',
                    'Thermal roll 50 × 30 mm',
                    'Thermische rol 50 × 30 mm'
                  )}
                </option>
                <option value="bin_90x50">
                  {tr(
                    language,
                    'Étiquette de bac / étagère 90 × 50 mm',
                    'Bin / shelf label 90 × 50 mm',
                    'Bak- / schapetiket 90 × 50 mm'
                  )}
                </option>
              </SearchableSelect>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                {tr(
                  language,
                  'Nombre de copies par article',
                  'Number of copies per item',
                  'Aantal kopieën per artikel'
                )}
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={copiesPerItem}
                onChange={(e) => setCopiesPerItem(Math.max(1, Number(e.target.value) || 1))}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono font-bold"
              />
            </div>

            {canViewPrices && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPrice}
                  onChange={(e) => setShowPrice(e.target.checked)}
                  className="rounded text-orange-600"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {tr(
                    language,
                    'Afficher le prix unitaire HT',
                    'Show unit price (excl. VAT)',
                    'Eenheidsprijs (excl. btw) tonen'
                  )}
                </span>
              </label>
            )}

            {statusMessage && (
              <div className="p-3 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 font-bold">
                {statusMessage}
              </div>
            )}

            <div className="pt-4 space-y-2">
              <button
                type="button"
                disabled={printing}
                onClick={handleSystemPrint}
                className="w-full py-2.5 px-4 rounded-xl font-black bg-orange-600 hover:bg-orange-700 text-white flex items-center justify-center gap-2 shadow-xs"
              >
                <Printer className="w-4 h-4" />
                {tr(
                  language,
                  'Imprimer (Pilote système / A4 / Thermique)',
                  'Print (System driver / A4 / Thermal)',
                  'Afdrukken (Systeemsdriver / A4 / Thermisch)'
                )}
              </button>

              {isDesktopApp() && (
                <button
                  type="button"
                  disabled={printing}
                  onClick={handleZplPrint}
                  className="w-full py-2.5 px-4 rounded-xl font-bold border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 flex items-center justify-center gap-2"
                >
                  <Terminal className="w-4 h-4 text-orange-600" />
                  {tr(
                    language,
                    'Imprimer en ZPL direct (Zebra)',
                    'Print direct ZPL (Zebra)',
                    'Direct in ZPL afdrukken (Zebra)'
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="col-span-8 bg-slate-100 dark:bg-slate-950 p-6 overflow-auto">
            <div
              className="bg-white text-slate-900 rounded-xl shadow-md p-6 min-h-full"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
