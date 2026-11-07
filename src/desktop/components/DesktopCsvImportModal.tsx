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
import { tr } from '../../i18n/dutchTranslator';
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

const TARGET_FIELDS: Array<{
  field: CsvImportTargetField;
  labelFr: string;
  labelEn: string;
  labelNl: string;
  required?: boolean;
}> = [
  {
    field: 'reference',
    labelFr: 'Référence article',
    labelEn: 'Item reference',
    labelNl: 'Artikelreferentie',
    required: true,
  },
  { field: 'brand', labelFr: 'Marque', labelEn: 'Brand', labelNl: 'Merk' },
  {
    field: 'model',
    labelFr: 'Modèle / Désignation',
    labelEn: 'Model / Designation',
    labelNl: 'Model / Omschrijving',
    required: true,
  },
  {
    field: 'category_name',
    labelFr: 'Catégorie / Sous-catégorie',
    labelEn: 'Category / Sub-category',
    labelNl: 'Categorie / Subcategorie',
  },
  { field: 'store_name', labelFr: 'Dépôt', labelEn: 'Depot', labelNl: 'Depot' },
  {
    field: 'rack_location',
    labelFr: 'Emplacement (Casier)',
    labelEn: 'Location (Bin)',
    labelNl: 'Locatie (Vak)',
  },
  {
    field: 'quantity',
    labelFr: 'Stock initial',
    labelEn: 'Initial stock',
    labelNl: 'Initiële voorraad',
  },
  {
    field: 'min_stock_alert',
    labelFr: "Seuil d'alerte",
    labelEn: 'Min stock alert',
    labelNl: 'Waarschuwingsdrempel',
  },
  {
    field: 'unit_price',
    labelFr: 'Prix unitaire HT',
    labelEn: 'Unit price (excl. VAT)',
    labelNl: 'Eenheidsprijs (excl. btw)',
  },
  {
    field: 'barcode',
    labelFr: 'Code-barres 1D',
    labelEn: '1D Barcode',
    labelNl: '1D-streepjescode',
  },
  {
    field: 'manufacturer_ref',
    labelFr: 'Réf fabricant (OEM)',
    labelEn: 'Manufacturer ref (OEM)',
    labelNl: 'Fabrikantreferentie (OEM)',
  },
  {
    field: 'supplier_1_name',
    labelFr: 'Fournisseur principal',
    labelEn: 'Main supplier',
    labelNl: 'Hoofdleverancier',
  },
  {
    field: 'ref_supplier_1',
    labelFr: 'Réf fournisseur',
    labelEn: 'Supplier reference',
    labelNl: 'Leveranciersreferentie',
  },
  {
    field: 'description',
    labelFr: 'Description',
    labelEn: 'Description',
    labelNl: 'Beschrijving',
  },
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
    language,
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
        error: tr(
          language,
          'Le fichier dépasse la taille maximale autorisée de 5 Mo.',
          'The file exceeds the maximum allowed size of 5 MB.',
          'Het bestand overschrijdt de maximaal toegestane grootte van 5 MB.'
        ),
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
            message:
              row.status === 'update'
                ? tr(language, 'Mis à jour', 'Updated', 'Bijgewerkt')
                : tr(language, 'Créé', 'Created', 'Aangemaakt'),
          });
        } else {
          results.push({
            rowIndex: row.rowIndex,
            reference: row.productDraft.reference,
            outcome: 'error',
            message: tr(
              language,
              'Refusé par les règles de gestion',
              'Rejected by business rules',
              'Geweigerd door beheersregels'
            ),
          });
        }
      } catch (err: any) {
        results.push({
          rowIndex: row.rowIndex,
          reference: row.productDraft.reference,
          outcome: 'error',
          message:
            err?.message ||
            tr(
              language,
              "Erreur d'écriture en base",
              'Database write error',
              'Database-schrijffout'
            ),
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
                {tr(
                  language,
                  "Assistant d'import CSV du catalogue articles",
                  'Catalog CSV Import Wizard',
                  'CSV-importassistent voor de artikelcatalogus'
                )}
              </h2>
              <p className="text-xs text-slate-500">
                {tr(language, 'Étape', 'Step', 'Stap')} {step}/3 —{' '}
                {step === 1
                  ? tr(
                      language,
                      'Sélection du fichier et correspondance des colonnes',
                      'File selection and column mapping',
                      'Bestandsselectie en kolomtoewijzing'
                    )
                  : step === 2
                  ? tr(
                      language,
                      'Aperçu, contrôle des doublons et vérification du quota licence',
                      'Preview, duplicate check and license quota verification',
                      'Voorbeeld, duplicaatcontrole en licentiequotumverificatie'
                    )
                  : tr(
                      language,
                      "Rapport d'exécution de l'import",
                      'Import execution report',
                      'Uitvoeringsrapport van de import'
                    )}
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
              {tr(
                language,
                'Vous ne disposez pas de la permission « Créer un article » (`perm_action_create_prod`).',
                'You do not have the "Create product" permission (`perm_action_create_prod`).',
                'U beschikt niet over de machtiging "Artikel aanmaken" (`perm_action_create_prod`).'
              )}
            </div>
          )}

          {step === 1 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">
                    {tr(
                      language,
                      '1. Choisissez votre fichier CSV (UTF-8 ou Windows-1252, séparateur `;` ou `,`)',
                      '1. Choose your CSV file (UTF-8 or Windows-1252, separator `;` or `,`)',
                      '1. Kies uw CSV-bestand (UTF-8 of Windows-1252, scheidingsteken `;` of `,`)'
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {tr(
                      language,
                      'Maximum 5 Mo et 5 000 lignes par import. Protection anti-formules tableur active.',
                      'Maximum 5 MB and 5,000 rows per import. Spreadsheet formula injection protection active.',
                      'Maximaal 5 MB en 5.000 rijen per import. Bescherming tegen spreadsheetformules actief.'
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100"
                  >
                    <Download className="w-3.5 h-3.5 text-orange-600" />
                    {tr(
                      language,
                      'Télécharger un fichier modèle',
                      'Download template file',
                      'Voorbeeldbestand downloaden'
                    )}
                  </button>
                  <label className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-bold bg-orange-600 hover:bg-orange-700 text-white cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    {tr(
                      language,
                      'Choisir un fichier CSV',
                      'Choose CSV file',
                      'CSV-bestand kiezen'
                    )}
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
                      {tr(language, 'Fichier chargé :', 'Loaded file:', 'Geladen bestand:')}{' '}
                      <span className="font-mono">{fileName}</span> ({parsedSheet.rows.length}{' '}
                      {tr(
                        language,
                        'lignes détectées, séparateur «',
                        'rows detected, separator "',
                        'rijen gedetecteerd, scheidingsteken «'
                      )}{' '}
                      {parsedSheet.separator} »)
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">
                        {tr(
                          language,
                          'Doublons de référence :',
                          'Duplicate references:',
                          'Dubbele referenties:'
                        )}
                      </span>
                      <select
                        value={duplicateStrategy}
                        onChange={(e) =>
                          setDuplicateStrategy(e.target.value as 'update' | 'skip')
                        }
                        className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                      >
                        <option value="update">
                          {tr(
                            language,
                            'Mettre à jour les articles existants',
                            'Update existing items',
                            'Bestaande artikelen bijwerken'
                          )}
                        </option>
                        <option value="skip">
                          {tr(
                            language,
                            'Ignorer les références déjà présentes',
                            'Skip existing references',
                            'Reeds aanwezige referenties negeren'
                          )}
                        </option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                    {TARGET_FIELDS.map((tf) => (
                      <div key={tf.field} className="flex items-center justify-between gap-2">
                        <label className="font-semibold text-slate-700 dark:text-slate-300">
                          {tr(language, tf.labelFr, tf.labelEn, tf.labelNl)}{' '}
                          {tf.required && <span className="text-rose-500">*</span>}
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
                          <option value="">
                            {tr(language, '-- Non mappé --', '-- Unmapped --', '-- Niet gekoppeld --')}
                          </option>
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
                    {tr(language, 'Nouveaux articles', 'New items', 'Nieuwe artikelen')}
                  </div>
                  <div className="font-mono text-xl font-black text-emerald-700 dark:text-emerald-300">
                    {validation.toCreateCount}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800">
                  <div className="text-[10px] font-bold uppercase text-sky-700">
                    {tr(language, 'Mises à jour', 'Updates', 'Updates')}
                  </div>
                  <div className="font-mono text-xl font-black text-sky-700 dark:text-sky-300">
                    {validation.toUpdateCount}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
                  <div className="text-[10px] font-bold uppercase text-amber-700">
                    {tr(language, 'Doublons ignorés', 'Skipped duplicates', 'Genegeerde duplicaten')}
                  </div>
                  <div className="font-mono text-xl font-black text-amber-700 dark:text-amber-300">
                    {validation.duplicateInFileCount}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800">
                  <div className="text-[10px] font-bold uppercase text-rose-700">
                    {tr(language, 'Lignes en erreur', 'Rows with errors', 'Rijen met fouten')}
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
                      {tr(
                        language,
                        `Plafond de références de votre licence dépassé (${validation.projectedTotalReferences} / ${validation.maxReferencesAllowed} max)`,
                        `License reference limit exceeded (${validation.projectedTotalReferences} / ${validation.maxReferencesAllowed} max)`,
                        `Referentielimiet van uw licentie overschreden (${validation.projectedTotalReferences} / ${validation.maxReferencesAllowed} max)`
                      )}
                    </div>
                    <p className="text-[11px]">
                      {tr(
                        language,
                        'Réduisez le nombre de nouveaux articles dans le fichier ou passez à une formule supérieure dans Paramètres > Licence.',
                        'Reduce the number of new items in the file or upgrade your plan in Settings > License.',
                        'Verlaag het aantal nieuwe artikelen in het bestand of upgrade uw abonnement in Instellingen > Licentie.'
                      )}
                    </p>
                  </div>
                </div>
              )}

              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-[10px] font-bold uppercase text-slate-500">
                    <tr>
                      <th className="py-2 px-3">{tr(language, 'Ligne', 'Row', 'Rij')}</th>
                      <th className="py-2 px-3">
                        {tr(language, 'Référence', 'Reference', 'Referentie')}
                      </th>
                      <th className="py-2 px-3">
                        {tr(language, 'Désignation', 'Designation', 'Omschrijving')}
                      </th>
                      <th className="py-2 px-3 text-right">
                        {tr(language, 'Stock', 'Stock', 'Voorraad')}
                      </th>
                      <th className="py-2 px-3 text-right">
                        {tr(language, 'Prix HT', 'Unit Price', 'Prijs excl.')}
                      </th>
                      <th className="py-2 px-3">
                        {tr(language, 'Action / Contrôle', 'Action / Check', 'Actie / Controle')}
                      </th>
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
                            <span className="text-emerald-600 font-bold">
                              {tr(language, 'Création', 'Create', 'Aanmaken')}
                            </span>
                          )}
                          {r.status === 'update' && (
                            <span className="text-sky-600 font-bold">
                              {tr(language, 'Mise à jour', 'Update', 'Bijwerken')}
                            </span>
                          )}
                          {r.status === 'add_depot' && (
                            <span className="text-orange-600 font-bold">
                              {tr(language, 'Ajout dépôt', 'Add depot', 'Depot toevoegen')} (
                              {r.productDraft.store_name})
                            </span>
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
                  {tr(language, 'Import en cours :', 'Importing:', 'Importeren bezig:')}{' '}
                  {progressIndex} / {validation.rows.length}{' '}
                  {tr(language, 'lignes traitées...', 'rows processed...', 'rijen verwerkt...')}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 text-center py-6">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                {tr(
                  language,
                  `Import CSV terminé (${importResults.length} lignes analysées)`,
                  `CSV Import completed (${importResults.length} rows analyzed)`,
                  `CSV-import voltooid (${importResults.length} rijen geanalyseerd)`
                )}
              </h3>
              <p className="text-slate-500">
                {tr(language, 'Créés :', 'Created:', 'Aangemaakt:')}{' '}
                <strong>
                  {importResults.filter((r) => r.outcome === 'created').length}
                </strong>{' '}
                • {tr(language, 'Mis à jour :', 'Updated:', 'Bijgewerkt:')}{' '}
                <strong>
                  {importResults.filter((r) => r.outcome === 'updated').length}
                </strong>{' '}
                • {tr(language, 'Ignorés :', 'Skipped:', 'Genegeerd:')}{' '}
                <strong>
                  {importResults.filter((r) => r.outcome === 'skipped').length}
                </strong>{' '}
                • {tr(language, 'Erreurs :', 'Errors:', 'Fouten:')}{' '}
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
                {tr(
                  language,
                  'Télécharger le rapport CSV détaillé',
                  'Download detailed CSV report',
                  'Gedetailleerd CSV-rapport downloaden'
                )}
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
            {tr(language, 'Fermer', 'Close', 'Sluiten')}
          </button>

          <div className="flex items-center gap-2">
            {step === 2 && (
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700"
              >
                {tr(
                  language,
                  'Retour au mappage',
                  'Back to mapping',
                  'Terug naar kolomkoppeling'
                )}
              </button>
            )}
            {step === 1 && (
              <button
                type="button"
                disabled={!parsedSheet || Boolean(parsedSheet.error) || !mapping.reference}
                onClick={() => setStep(2)}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 disabled:opacity-40 text-white"
              >
                {tr(
                  language,
                  'Suivant : Aperçu & Validation',
                  'Next: Preview & Validation',
                  'Volgende: Voorbeeld & Validatie'
                )}
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
                {tr(
                  language,
                  `Lancer l'import (${validation.toCreateCount + validation.toUpdateCount} articles)`,
                  `Run import (${validation.toCreateCount + validation.toUpdateCount} items)`,
                  `Import starten (${validation.toCreateCount + validation.toUpdateCount} artikelen)`
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
