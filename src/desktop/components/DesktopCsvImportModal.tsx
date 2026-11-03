import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  CSV_IMPORT_MAX_BYTES,
  CsvColumnMapping,
  CsvImportTargetField,
  ParsedCsvSheet,
  buildCsvImportReportContent,
  buildCsvImportTemplateContent,
  decodeCsvArrayBuffer,
  guessCsvColumnMapping,
  parseCsvText,
  validateCsvProductImport,
} from '../../services/csvProductImport';

interface DesktopCsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TARGET_FIELDS: Array<{ field: CsvImportTargetField; label: string; required?: boolean }> = [
  { field: 'reference', label: 'Référence article', required: true },
  { field: 'brand', label: 'Marque' },
  { field: 'model', label: 'Modèle / Désignation', required: true },
  { field: 'category_name', label: 'Catégorie / Sous-catégorie' },
  { field: 'store_name', label: 'Dépôt' },
  { field: 'rack_location', label: 'Emplacement (Casier)' },
  { field: 'quantity', label: 'Stock initial' },
  { field: 'min_stock_alert', label: "Seuil d'alerte" },
  { field: 'unit_price', label: 'Prix unitaire HT' },
  { field: 'barcode', label: 'Code-barres 1D' },
  { field: 'manufacturer_ref', label: 'Réf fabricant (OEM)' },
  { field: 'supplier_1_name', label: 'Fournisseur principal' },
  { field: 'ref_supplier_1', label: 'Réf fournisseur' },
  { field: 'description', label: 'Description' },
];

export const DesktopCsvImportModal: React.FC<DesktopCsvImportModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    products,
    subCategories,
    license,
    userHasPermission,
    saveProduct,
  } = useApp();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState('');
  const [parsedSheet, setParsedSheet] = useState<ParsedCsvSheet | null>(null);
  const [mapping, setMapping] = useState<CsvColumnMapping>({});
  const [duplicateStrategy, setDuplicateStrategy] = useState<'update' | 'skip'>('update');
  const [defaultDepotName] = useState('Dépôt Principal');
  const [importing, setImporting] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [importResults, setImportResults] = useState<
    Array<{
      rowIndex: number;
      reference: string;
      outcome: 'created' | 'updated' | 'skipped' | 'error';
      message?: string;
    }>
  >([]);

  const canCreateProduct =
    userHasPermission('perm_action_create_prod') || userHasPermission('perm_prod_add');

  const validation = useMemo(() => {
    if (!parsedSheet || parsedSheet.rows.length === 0) return null;
    return validateCsvProductImport({
      rows: parsedSheet.rows,
      mapping,
      existingProducts: products,
      subCategories,
      defaultDepotName,
      duplicateStrategy,
      license,
    });
  }, [parsedSheet, mapping, products, subCategories, defaultDepotName, duplicateStrategy, license]);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    if (file.size > CSV_IMPORT_MAX_BYTES) {
      setParsedSheet({
        separator: ';',
        headers: [],
        rows: [],
        error: 'Le fichier dépasse la taille maximale autorisée de 5 Mo.',
      });
      return;
    }
    const buffer = await file.arrayBuffer();
    const decoded = decodeCsvArrayBuffer(buffer);
    const sheet = parseCsvText(decoded, file.size);
    setParsedSheet(sheet);
    if (!sheet.error && sheet.headers.length > 0) {
      setMapping(guessCsvColumnMapping(sheet.headers));
    }
  };

  const handleDownloadTemplate = () => {
    const content = buildCsvImportTemplateContent();
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tot-stock-modele-import-articles.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleExecuteImport = async () => {
    if (!validation || validation.quotaExceeded || !canCreateProduct) return;
    setImporting(true);
    setProgressIndex(0);
    const results: typeof importResults = [];

    for (let i = 0; i < validation.rows.length; i++) {
      const row = validation.rows[i];
      setProgressIndex(i + 1);
      if (row.status === 'error') {
        results.push({
          rowIndex: row.rowIndex,
          reference: row.productDraft.reference || '?',
          outcome: 'error',
          message: row.errors.join(' | '),
        });
        continue;
      }
      if (row.status === 'duplicate_in_file') {
        results.push({
          rowIndex: row.rowIndex,
          reference: row.productDraft.reference,
          outcome: 'skipped',
          message: row.errors.join(' | '),
        });
        continue;
      }

      try {
        const ok = await saveProduct(row.productDraft, {
          isNew: !row.existingProductId,
          editingId: row.existingProductId || null,
        });
        if (ok) {
          results.push({
            rowIndex: row.rowIndex,
            reference: row.productDraft.reference,
            outcome: row.status === 'update' ? 'updated' : 'created',
            message: row.status === 'update' ? 'Mis à jour' : 'Créé',
          });
        } else {
          results.push({
            rowIndex: row.rowIndex,
            reference: row.productDraft.reference,
            outcome: 'error',
            message: 'Refusé par les règles de gestion',
          });
        }
      } catch (err: any) {
        results.push({
          rowIndex: row.rowIndex,
          reference: row.productDraft.reference,
          outcome: 'error',
          message: err?.message || "Erreur d'écriture en base",
        });
      }
    }

    setImportResults(results);
    setImporting(false);
    setStep(3);
  };

  const handleDownloadReport = () => {
    const content = buildCsvImportReportContent(importResults);
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rapport-import-csv-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-6">
      <div className="w-full max-w-4xl max-h-[88vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-100 dark:bg-orange-950/70 text-orange-600 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                Assistant d'import CSV du catalogue articles
              </h2>
              <p className="text-xs text-slate-500">
                Étape {step}/3 —{' '}
                {step === 1
                  ? 'Sélection du fichier et correspondance des colonnes'
                  : step === 2
                  ? 'Aperçu, contrôle des doublons et vérification du quota licence'
                  : "Rapport d'exécution de l'import"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {!canCreateProduct && (
            <div className="p-4 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 font-bold">
              Vous ne disposez pas de la permission « Créer un article » (`perm_action_create_prod`).
            </div>
          )}

          {step === 1 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">
                    1. Choisissez votre fichier CSV (UTF-8 ou Windows-1252, séparateur `;` ou `,`)
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Maximum 5 Mo et 5 000 lignes par import. Protection anti-formules tableur active.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100"
                  >
                    <Download className="w-3.5 h-3.5 text-orange-600" />
                    Télécharger un fichier modèle
                  </button>
                  <label className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-bold bg-orange-600 hover:bg-orange-700 text-white cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    Choisir un fichier CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {parsedSheet?.error && (
                <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 text-rose-700 dark:text-rose-300 font-bold">
                  {parsedSheet.error}
                </div>
              )}

              {parsedSheet && !parsedSheet.error && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-slate-800 dark:text-slate-200">
                      Fichier chargé : <span className="font-mono">{fileName}</span> (
                      {parsedSheet.rows.length} lignes détectées, séparateur «{' '}
                      {parsedSheet.separator} »)
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Doublons de référence :</span>
                      <select
                        value={duplicateStrategy}
                        onChange={(e) =>
                          setDuplicateStrategy(e.target.value as 'update' | 'skip')
                        }
                        className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                      >
                        <option value="update">Mettre à jour les articles existants</option>
                        <option value="skip">Ignorer les références déjà présentes</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                    {TARGET_FIELDS.map((tf) => (
                      <div key={tf.field} className="flex items-center justify-between gap-2">
                        <label className="font-semibold text-slate-700 dark:text-slate-300">
                          {tf.label} {tf.required && <span className="text-rose-500">*</span>}
                        </label>
                        <select
                          value={mapping[tf.field] || ''}
                          onChange={(e) =>
                            setMapping((prev) => ({
                              ...prev,
                              [tf.field]: e.target.value || undefined,
                            }))
                          }
                          className="w-48 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                        >
                          <option value="">-- Non mappé --</option>
                          {parsedSheet.headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {step === 2 && validation && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
                  <div className="text-[10px] font-bold uppercase text-emerald-700">
                    Nouveaux articles
                  </div>
                  <div className="font-mono text-xl font-black text-emerald-700 dark:text-emerald-300">
                    {validation.toCreateCount}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800">
                  <div className="text-[10px] font-bold uppercase text-sky-700">
                    Mises à jour
                  </div>
                  <div className="font-mono text-xl font-black text-sky-700 dark:text-sky-300">
                    {validation.toUpdateCount}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
                  <div className="text-[10px] font-bold uppercase text-amber-700">
                    Doublons ignorés
                  </div>
                  <div className="font-mono text-xl font-black text-amber-700 dark:text-amber-300">
                    {validation.duplicateInFileCount}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800">
                  <div className="text-[10px] font-bold uppercase text-rose-700">
                    Lignes en erreur
                  </div>
                  <div className="font-mono text-xl font-black text-rose-700 dark:text-rose-300">
                    {validation.errorCount}
                  </div>
                </div>
              </div>

              {validation.quotaExceeded && (
                <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-300 text-rose-700 dark:text-rose-200 flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <div>
                    <div className="font-black">
                      Plafond de références de votre licence dépassé ({validation.projectedTotalReferences} /{' '}
                      {validation.maxReferencesAllowed} max)
                    </div>
                    <p className="text-[11px]">
                      Réduisez le nombre de nouveaux articles dans le fichier ou passez à une formule supérieure dans Paramètres &gt; Licence.
                    </p>
                  </div>
                </div>
              )}

              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-[10px] font-bold uppercase text-slate-500">
                    <tr>
                      <th className="py-2 px-3">Ligne</th>
                      <th className="py-2 px-3">Référence</th>
                      <th className="py-2 px-3">Désignation</th>
                      <th className="py-2 px-3 text-right">Stock</th>
                      <th className="py-2 px-3 text-right">Prix HT</th>
                      <th className="py-2 px-3">Action / Contrôle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {validation.rows.slice(0, 100).map((r) => (
                      <tr key={r.rowIndex}>
                        <td className="py-2 px-3 font-mono text-slate-400">#{r.rowIndex}</td>
                        <td className="py-2 px-3 font-mono font-bold">
                          {r.productDraft.reference || '—'}
                        </td>
                        <td className="py-2 px-3">
                          {r.productDraft.brand} {r.productDraft.model}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {r.productDraft.quantity}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {r.productDraft.unit_price.toFixed(2)}
                        </td>
                        <td className="py-2 px-3">
                          {r.status === 'create' && (
                            <span className="text-emerald-600 font-bold">Création</span>
                          )}
                          {r.status === 'update' && (
                            <span className="text-sky-600 font-bold">Mise à jour</span>
                          )}
                          {r.status === 'duplicate_in_file' && (
                            <span className="text-amber-600 font-bold">{r.errors[0]}</span>
                          )}
                          {r.status === 'error' && (
                            <span className="text-rose-600 font-bold">
                              {r.errors.join(', ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {importing && (
                <div className="p-3 rounded-xl bg-orange-50 text-orange-800 font-bold text-center">
                  Import en cours : {progressIndex} / {validation.rows.length} lignes traitées...
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 text-center py-6">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                Import CSV terminé ({importResults.length} lignes analysées)
              </h3>
              <p className="text-slate-500">
                Créés :{' '}
                <strong>
                  {importResults.filter((r) => r.outcome === 'created').length}
                </strong>{' '}
                • Mis à jour :{' '}
                <strong>
                  {importResults.filter((r) => r.outcome === 'updated').length}
                </strong>{' '}
                • Ignorés :{' '}
                <strong>
                  {importResults.filter((r) => r.outcome === 'skipped').length}
                </strong>{' '}
                • Erreurs :{' '}
                <strong>
                  {importResults.filter((r) => r.outcome === 'error').length}
                </strong>
              </p>
              <button
                type="button"
                onClick={handleDownloadReport}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold bg-slate-900 text-white hover:bg-slate-800"
              >
                <Download className="w-4 h-4" />
                Télécharger le rapport CSV détaillé
              </button>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100"
          >
            Fermer
          </button>

          <div className="flex items-center gap-2">
            {step === 2 && (
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700"
              >
                Retour au mappage
              </button>
            )}
            {step === 1 && (
              <button
                type="button"
                disabled={!parsedSheet || Boolean(parsedSheet.error) || !mapping.reference}
                onClick={() => setStep(2)}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 disabled:opacity-40 text-white"
              >
                Suivant : Aperçu & Validation
              </button>
            )}
            {step === 2 && validation && (
              <button
                type="button"
                disabled={
                  importing ||
                  validation.quotaExceeded ||
                  !canCreateProduct ||
                  validation.toCreateCount + validation.toUpdateCount === 0
                }
                onClick={handleExecuteImport}
                className="px-5 py-2 rounded-lg text-xs font-black bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white"
              >
                Lancer l'import ({validation.toCreateCount + validation.toUpdateCount} articles)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
