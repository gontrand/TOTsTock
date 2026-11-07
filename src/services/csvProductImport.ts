import { LicenseInfo, Product, SubCategory } from '../types';
import { getPlanMaxReferences } from './licenseService';
import { sanitizeCsvCell } from './desktopInventoryLogic';

export const CSV_IMPORT_MAX_BYTES = 5 * 1024 * 1024; // 5 Mo
export const CSV_IMPORT_MAX_ROWS = 5000;

export type CsvImportTargetField =
  | 'reference'
  | 'brand'
  | 'model'
  | 'description'
  | 'category_name'
  | 'store_name'
  | 'rack_location'
  | 'quantity'
  | 'min_stock_alert'
  | 'unit_price'
  | 'barcode'
  | 'manufacturer_ref'
  | 'supplier_1_name'
  | 'ref_supplier_1';

export type CsvColumnMapping = Partial<Record<CsvImportTargetField, string>>;

export interface ParsedCsvSheet {
  separator: ',' | ';';
  headers: string[];
  rows: Record<string, string>[];
  error?: string;
}

export type CsvRowValidationStatus = 'create' | 'update' | 'add_depot' | 'duplicate_in_file' | 'error';

export interface ValidatedCsvProductRow {
  rowIndex: number; // 1-based data row index
  status: CsvRowValidationStatus;
  errors: string[];
  existingProductId?: string;
  productDraft: Omit<Product, 'id'>;
  categoryName?: string;
}

export interface CsvValidationSummary {
  rows: ValidatedCsvProductRow[];
  toCreateCount: number;
  toUpdateCount: number;
  toAddDepotCount?: number;
  duplicateInFileCount: number;
  errorCount: number;
  quotaExceeded: boolean;
  maxReferencesAllowed: number;
  projectedTotalReferences: number;
}

/**
 * Neutralise les formules tableur (`=`, `+`, `-`, `@`, tabulation ou retour chariot en tête)
 * lors de la lecture ou de l'export d'une cellule texte issue d'un CSV.
 */
export function neutralizeFormulaInjectionOnImport(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    return trimmed.replace(/^[=+\-@\t\r]+/, '').trim();
  }
  return trimmed;
}

/**
 * Décode un buffer binaire CSV en détectant l'UTF-8 (avec ou sans BOM) ou le Windows-1252.
 */
export function decodeCsvArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  try {
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    return utf8Decoder.decode(bytes);
  } catch {
    const winDecoder = new TextDecoder('windows-1252');
    return winDecoder.decode(bytes);
  }
}

/**
 * Détecte automatiquement le séparateur `,` ou `;` sur la première ligne non vide.
 */
export function detectCsvSeparator(sampleText: string): ',' | ';' {
  const firstLine = (sampleText || '').split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  return semicolonCount >= commaCount ? ';' : ',';
}

/**
 * Parse une ligne CSV en gérant les guillemets doubles échappés (`""`).
 */
export function parseCsvLine(line: string, separator: ',' | ';'): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === separator && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Analyse le texte CSV complet (avec vérification de taille <= 5 Mo et <= 5 000 lignes).
 */
export function parseCsvText(rawText: string, byteLength?: number): ParsedCsvSheet {
  const actualBytes =
    byteLength !== undefined ? byteLength : new TextEncoder().encode(rawText || '').length;
  if (actualBytes > CSV_IMPORT_MAX_BYTES) {
    return {
      separator: ';',
      headers: [],
      rows: [],
      error: 'Le fichier dépasse la taille maximale autorisée de 5 Mo.',
    };
  }

  const cleanedText = (rawText || '').replace(/^\uFEFF/, '');
  const separator = detectCsvSeparator(cleanedText);
  const rawLines = cleanedText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (rawLines.length === 0) {
    return {
      separator,
      headers: [],
      rows: [],
      error: 'Le fichier CSV est vide.',
    };
  }

  const dataLineCount = Math.max(0, rawLines.length - 1);
  if (dataLineCount > CSV_IMPORT_MAX_ROWS) {
    return {
      separator,
      headers: [],
      rows: [],
      error: `Le fichier contient ${dataLineCount} lignes (maximum autorisé : ${CSV_IMPORT_MAX_ROWS} lignes par import).`,
    };
  }

  const headers = parseCsvLine(rawLines[0], separator).map((h, idx) => h || `Colonne_${idx + 1}`);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < rawLines.length; i++) {
    const values = parseCsvLine(rawLines[i], separator);
    if (values.every((v) => !v)) continue;
    const record: Record<string, string> = {};
    headers.forEach((h, colIdx) => {
      record[h] = values[colIdx] ?? '';
    });
    rows.push(record);
  }

  return { separator, headers, rows };
}

/**
 * Propose une correspondance automatique entre les en-têtes du CSV et les champs d'un article TOT Stock.
 */
export function guessCsvColumnMapping(headers: string[]): CsvColumnMapping {
  const mapping: CsvColumnMapping = {};
  const patterns: Array<{ field: CsvImportTargetField; regex: RegExp }> = [
    { field: 'reference', regex: /^(r[eé]f[eé]rence|ref|code_article|sku|article_ref)$/i },
    { field: 'brand', regex: /^(marque|brand|fabricant)$/i },
    { field: 'model', regex: /^(mod[eè]le|model|d[eé]signation|nom|libell[eé]|name|title)$/i },
    { field: 'description', regex: /^(description|d[eé]tail|notes)$/i },
    { field: 'category_name', regex: /^(cat[eé]gorie|sous[-_ ]?cat[eé]gorie|category|famille)$/i },
    { field: 'store_name', regex: /^(d[eé]p[oô]t|magasin|store|depot|warehouse)$/i },
    { field: 'rack_location', regex: /^(emplacement|casier|rayon|rack|location)$/i },
    { field: 'quantity', regex: /^(quantit[eé]|stock|qty|quantity|qte)$/i },
    { field: 'min_stock_alert', regex: /^(seuil|alerte|min_stock|stock_min|seuil_alerte)$/i },
    { field: 'unit_price', regex: /^(prix|prix_ht|prix_unitaire|unit_price|price|pu)$/i },
    { field: 'barcode', regex: /^(code[-_ ]?barres|ean|barcode|gtin)$/i },
    { field: 'manufacturer_ref', regex: /^(r[eé]f[-_ ]?fabricant|oem|manufacturer_ref)$/i },
    { field: 'supplier_1_name', regex: /^(fournisseur|supplier|fournisseur_1)$/i },
    { field: 'ref_supplier_1', regex: /^(r[eé]f[-_ ]?fournisseur|supplier_ref)$/i },
  ];

  for (const header of headers) {
    const clean = header.trim();
    for (const { field, regex } of patterns) {
      if (!mapping[field] && regex.test(clean)) {
        mapping[field] = header;
        break;
      }
    }
  }
  return mapping;
}

function parseNonNegativeNumber(raw: string | undefined, fallback: number): { ok: boolean; value: number } {
  if (raw === undefined || raw.trim() === '') return { ok: true, value: fallback };
  const normalized = raw.trim().replace(/\s+/g, '').replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) {
    return { ok: false, value: fallback };
  }
  return { ok: true, value: num };
}

/**
 * Valide l'ensemble des lignes du CSV, détecte les créations, mises à jour, doublons dans le fichier,
 * erreurs de format et vérifie le plafond de références (`max_references`) de la licence.
 */
export function validateCsvProductImport(params: {
  rows: Record<string, string>[];
  mapping: CsvColumnMapping;
  existingProducts: Product[];
  subCategories?: SubCategory[];
  defaultDepotName?: string;
  duplicateStrategy?: 'skip' | 'update';
  license?: LicenseInfo | null;
}): CsvValidationSummary {
  const {
    rows,
    mapping,
    existingProducts,
    subCategories = [],
    defaultDepotName = 'Dépôt Principal',
    duplicateStrategy = 'update',
    license,
  } = params;

  const existingByRef = new Map<string, Product>();
  for (const prod of existingProducts || []) {
    if (prod.reference) {
      existingByRef.set(prod.reference.trim().toLowerCase(), prod);
    }
  }

  const subCatByName = new Map<string, number>();
  for (const sc of subCategories) {
    if (sc.name) {
      subCatByName.set(sc.name.trim().toLowerCase(), sc.id);
    }
  }

  const seenRefsInFile = new Map<string, ValidatedCsvProductRow>();
  const seenRefDepotsInFile = new Set<string>();
  const validatedRows: ValidatedCsvProductRow[] = [];

  let toCreateCount = 0;
  let toUpdateCount = 0;
  let toAddDepotCount = 0;
  let duplicateInFileCount = 0;
  let errorCount = 0;

  rows.forEach((row, index) => {
    const getCell = (field: CsvImportTargetField): string => {
      const col = mapping[field];
      return col ? (row[col] ?? '').trim() : '';
    };

    const errors: string[] = [];
    const reference = neutralizeFormulaInjectionOnImport(getCell('reference'));
    const brand = neutralizeFormulaInjectionOnImport(getCell('brand'));
    const model = neutralizeFormulaInjectionOnImport(getCell('model'));
    const description = neutralizeFormulaInjectionOnImport(getCell('description'));
    const categoryName = neutralizeFormulaInjectionOnImport(getCell('category_name'));
    const storeName = neutralizeFormulaInjectionOnImport(getCell('store_name')) || defaultDepotName;
    const rackLocation = neutralizeFormulaInjectionOnImport(getCell('rack_location'));
    const barcode = neutralizeFormulaInjectionOnImport(getCell('barcode'));
    const manufacturerRef = neutralizeFormulaInjectionOnImport(getCell('manufacturer_ref'));
    const supplier1Name = neutralizeFormulaInjectionOnImport(getCell('supplier_1_name'));
    const refSupplier1 = neutralizeFormulaInjectionOnImport(getCell('ref_supplier_1'));

    const normRef = reference.toLowerCase();
    const normStore = storeName.trim().toLowerCase();
    const refDepotKey = `${normRef}::${normStore}`;
    const existingProduct = existingByRef.get(normRef);
    const firstRowInFile = seenRefsInFile.get(normRef);

    if (!reference) {
      errors.push('Référence obligatoire manquante');
    }
    if (!model && !brand && !existingProduct && !firstRowInFile) {
      errors.push('Désignation (Modèle ou Marque) obligatoire manquante');
    }

    const qtyRes = parseNonNegativeNumber(getCell('quantity'), 0);
    if (!qtyRes.ok) {
      errors.push('Stock initial invalide (nombre >= 0 attendu)');
    }
    const minAlertRes = parseNonNegativeNumber(getCell('min_stock_alert'), 5);
    if (!minAlertRes.ok) {
      errors.push("Seuil d'alerte invalide (nombre >= 0 attendu)");
    }
    const priceRes = parseNonNegativeNumber(getCell('unit_price'), 0);
    if (!priceRes.ok) {
      errors.push('Prix unitaire HT invalide (nombre >= 0 attendu)');
    }

    let status: CsvRowValidationStatus = 'create';

    if (errors.length > 0) {
      status = 'error';
      errorCount++;
    } else if (seenRefDepotsInFile.has(refDepotKey)) {
      status = 'duplicate_in_file';
      errors.push(`Référence "${reference}" en doublon pour le dépôt "${storeName}" dans le fichier CSV`);
      duplicateInFileCount++;
    } else {
      seenRefDepotsInFile.add(refDepotKey);
      if (firstRowInFile) {
        // Même référence sur une autre ligne avec un dépôt différent -> affectation multi-dépôt (ne compte pas dans max_references)
        status = 'add_depot';
        toAddDepotCount++;
        toUpdateCount++;
      } else if (existingProduct) {
        if (duplicateStrategy === 'skip') {
          status = 'duplicate_in_file';
          errors.push(`Référence "${reference}" déjà présente au catalogue (ignorée)`);
          duplicateInFileCount++;
        } else {
          const existingStore = (existingProduct.store_name || defaultDepotName).trim().toLowerCase();
          if (existingStore !== normStore) {
            status = 'add_depot';
            toAddDepotCount++;
            toUpdateCount++;
          } else {
            status = 'update';
            toUpdateCount++;
          }
        }
      } else {
        status = 'create';
        toCreateCount++;
      }
    }

    const matchedSubCatId = categoryName
      ? subCatByName.get(categoryName.toLowerCase()) ??
        existingProduct?.sub_category_id ??
        firstRowInFile?.productDraft.sub_category_id ??
        null
      : existingProduct?.sub_category_id ?? firstRowInFile?.productDraft.sub_category_id ?? null;

    const productDraft: Omit<Product, 'id'> = {
      reference,
      brand: brand || existingProduct?.brand || firstRowInFile?.productDraft.brand || 'Générique',
      model: model || existingProduct?.model || firstRowInFile?.productDraft.model || reference,
      description: description || existingProduct?.description || firstRowInFile?.productDraft.description || '',
      sub_category_id: matchedSubCatId,
      unit_price: priceRes.value || existingProduct?.unit_price || firstRowInFile?.productDraft.unit_price || 0,
      quantity: Math.trunc(qtyRes.value),
      min_stock_alert: Math.trunc(minAlertRes.value),
      store_name: storeName,
      room_name: existingProduct?.room_name || '',
      shelf_name: existingProduct?.shelf_name || '',
      rack_location: rackLocation || existingProduct?.rack_location || '',
      barcode: barcode || existingProduct?.barcode || firstRowInFile?.productDraft.barcode || reference,
      qr_code: existingProduct?.qr_code || reference,
      manufacturer_ref: manufacturerRef || existingProduct?.manufacturer_ref || '',
      supplier_1_name: supplier1Name || existingProduct?.supplier_1_name || '',
      ref_supplier_1: refSupplier1 || existingProduct?.ref_supplier_1 || '',
    };

    const validatedRow: ValidatedCsvProductRow = {
      rowIndex: index + 1,
      status,
      errors,
      existingProductId: existingProduct?.id,
      productDraft,
      categoryName: categoryName || undefined,
    };

    if (!firstRowInFile && status !== 'error') {
      seenRefsInFile.set(normRef, validatedRow);
    }

    validatedRows.push(validatedRow);
  });

  const maxReferencesAllowed = getPlanMaxReferences(license?.plan_type);
  const projectedTotalReferences = (existingProducts?.length || 0) + toCreateCount;
  const quotaExceeded = projectedTotalReferences > maxReferencesAllowed;

  return {
    rows: validatedRows,
    toCreateCount,
    toUpdateCount,
    toAddDepotCount,
    duplicateInFileCount,
    errorCount,
    quotaExceeded,
    maxReferencesAllowed,
    projectedTotalReferences,
  };
}

/**
 * Génère un fichier CSV modèle téléchargeable pour aider l'utilisateur à préparer son import.
 */
export function buildCsvImportTemplateContent(): string {
  const headers = [
    'reference',
    'brand',
    'model',
    'category_name',
    'store_name',
    'rack_location',
    'quantity',
    'min_stock_alert',
    'unit_price',
    'barcode',
    'manufacturer_ref',
  ];
  const sample1 = [
    'VIS-M8-40',
    'Wurth',
    'Vis hexagonale inox A2 M8x40',
    'Visserie',
    'Dépôt Principal',
    'A1-02',
    '250',
    '50',
    '0.18',
    '3258951234567',
    'WU-00840',
  ];
  const sample2 = [
    'DISJ-20A-C',
    'Schneider',
    'Disjoncteur DT40 1P+N 20A Courbe C',
    'Électricité',
    'Dépôt Principal',
    'B3-10',
    '12',
    '4',
    '14.50',
    '3303432012345',
    'A9N21024',
  ];

  return '\uFEFF' + [headers.join(';'), sample1.join(';'), sample2.join(';')].join('\r\n');
}

/**
 * Génère le rapport CSV téléchargeable à l'issue de l'import.
 */
export function buildCsvImportReportContent(
  results: Array<{
    rowIndex: number;
    reference: string;
    outcome: 'created' | 'updated' | 'skipped' | 'error';
    message?: string;
  }>
): string {
  const headers = ['Ligne', 'Référence', 'Statut', 'Détail'];
  const rows = results.map((r) =>
    [
      sanitizeCsvCell(String(r.rowIndex)),
      sanitizeCsvCell(r.reference),
      sanitizeCsvCell(r.outcome),
      sanitizeCsvCell(r.message || 'OK'),
    ].join(';')
  );
  return '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
}
