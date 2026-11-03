import DOMPurify from 'dompurify';
import { Product } from '../types';
import { formatCurrency } from '../utils/crypto';
import { generateBarcode1DDataUrl, generateQrCodeDataUrlWithTotLogo } from '../utils/qrCodeHelper';

export type CanonicalPrintLabelFormat =
  | 'avery_70x37'
  | 'avery_105x42'
  | 'thermal_50x30'
  | 'bin_90x50';

export type PrintLabelFormat = CanonicalPrintLabelFormat;

export type ModalLabelFormat =
  | 'avery_3x8'
  | 'avery_2x7'
  | 'thermal'
  | 'bin_rack'
  | 'catalog';

export type AnyLabelFormat = CanonicalPrintLabelFormat | ModalLabelFormat;

export interface ProductLabelVisuals {
  qr?: string;
  barcode?: string;
}

export interface ProductLabelRenderOptions {
  format: AnyLabelFormat;
  showQr?: boolean;
  showBarcode?: boolean;
  showLocation?: boolean;
  showPrice?: boolean;
  showOem?: boolean;
  canViewPrices?: boolean;
  locale?: string;
  imagesCache?: Record<string, ProductLabelVisuals>;
}

export interface OrderReadyLabelData {
  order_number: string;
  site_number?: string;
  site_name?: string;
  requester_name?: string;
  pickup_zone?: string;
  depot_name?: string;
  items_count?: number;
  qrDataUrl?: string;
}

/**
 * Échappe strictement tout texte issu d'un utilisateur, d'un produit ou d'une commande
 * avant insertion dans un gabarit HTML d'étiquette.
 */
export function escapeLabelHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Assainit un fragment HTML d'étiquette via DOMPurify (lorsque disponible dans un DOM)
 * et supprime systématiquement toute balise ou attribut dangereux en environnement Node/SSR.
 */
export function sanitizeLabelSheetHtml(rawHtml: string): string {
  if (!rawHtml) return '';
  try {
    if (typeof window !== 'undefined' && typeof DOMPurify?.sanitize === 'function') {
      return DOMPurify.sanitize(rawHtml);
    }
  } catch {
    // Fallback below for pure Node environment
  }
  return rawHtml
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*(iframe|object|embed|form|input|button)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '');
}

/**
 * Convertit n'importe quel code de format (modal ou RPC SQL) vers le format canonique SQL.
 */
export function toCanonicalPrintFormat(format: AnyLabelFormat | string): CanonicalPrintLabelFormat {
  switch (format) {
    case 'avery_3x8':
    case 'avery_70x37':
      return 'avery_70x37';
    case 'avery_2x7':
    case 'avery_105x42':
      return 'avery_105x42';
    case 'thermal':
    case 'thermal_50x30':
      return 'thermal_50x30';
    case 'bin_rack':
    case 'bin_90x50':
      return 'bin_90x50';
    default:
      return 'avery_70x37';
  }
}

/**
 * Convertit un format canonique ou modal vers le format interne de PrintLabelsModal.
 */
export function toModalLabelFormat(format: AnyLabelFormat | string): ModalLabelFormat {
  switch (format) {
    case 'avery_70x37':
    case 'avery_3x8':
      return 'avery_3x8';
    case 'avery_105x42':
    case 'avery_2x7':
      return 'avery_2x7';
    case 'thermal_50x30':
    case 'thermal':
      return 'thermal';
    case 'bin_90x50':
    case 'bin_rack':
      return 'bin_rack';
    case 'catalog':
      return 'catalog';
    default:
      return 'avery_3x8';
  }
}

/**
 * Génère les images (QR code avec logo TOT + code-barres 1D) pour une liste de produits.
 */
export async function generateProductVisualsMap(
  products: Product[],
  options: { showQr?: boolean; showBarcode?: boolean; existingCache?: Record<string, ProductLabelVisuals> } = {}
): Promise<Record<string, ProductLabelVisuals>> {
  const showQr = options.showQr ?? true;
  const showBarcode = options.showBarcode ?? true;
  const cache: Record<string, ProductLabelVisuals> = { ...(options.existingCache || {}) };
  const uniqueProducts = Array.from(new Set(products));

  for (const prod of uniqueProducts) {
    if (!cache[prod.id]) {
      cache[prod.id] = {};
    }
    if (showBarcode && !cache[prod.id].barcode) {
      const barcodeVal = prod.barcode || prod.reference;
      const bc = generateBarcode1DDataUrl(barcodeVal, {
        width: 1.4,
        height: 38,
        displayValue: true,
      });
      if (bc) {
        cache[prod.id].barcode = bc;
      }
    }
    if (showQr && !cache[prod.id].qr) {
      try {
        const qrPayload = (prod.qr_code || prod.reference || '').trim();
        const qr = await generateQrCodeDataUrlWithTotLogo(qrPayload, { size: 180, margin: 1 });
        cache[prod.id].qr = qr;
      } catch {
        // Ignore QR generation error in headless tests
      }
    }
  }

  return cache;
}

/**
 * Génère le fragment HTML de planche d'étiquettes produits (identique à PrintLabelsModal).
 */
export function renderProductLabelsSheetHtml(
  itemsToPrint: Product[],
  options: ProductLabelRenderOptions
): string {
  if (!itemsToPrint || itemsToPrint.length === 0) return '';

  const modalFormat = toModalLabelFormat(options.format);
  const showQr = options.showQr ?? true;
  const showBarcode = options.showBarcode ?? true;
  const showLocation = options.showLocation ?? true;
  const showPrice = options.showPrice ?? true;
  const showOem = options.showOem ?? true;
  const canViewPrices = options.canViewPrices ?? false;
  const effectiveShowPrice = canViewPrices && showPrice;
  const imagesCache = options.imagesCache || {};
  const locale = options.locale || 'fr-FR';

  let sheetContent = '';

  if (modalFormat === 'catalog') {
    sheetContent = `
      <div style="padding: 10px;">
        <div style="border-bottom: 2px solid #ea580c; padding-bottom: 8px; margin-bottom: 12px;">
          <h1 style="font-size: 16px; margin: 0; color: #0f172a; font-weight: 900;">TOT STOCK - CATALOGUE D'INVENTAIRE &amp; CODES DE TRAÇABILITÉ</h1>
          <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Date: ${escapeLabelHtml(new Date().toLocaleDateString(locale))} • Total: ${itemsToPrint.length} articles</div>
        </div>
        <table class="catalog-table">
          <thead>
            <tr>
              <th>Réf / Article</th>
              <th>Code-barres 1D</th>
              <th>QR Code</th>
              <th>Emplacement</th>
              <th>Stock</th>
              ${canViewPrices ? '<th>Prix HT</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${itemsToPrint
              .map((p) => {
                const img = imagesCache[p.id];
                return `
                  <tr>
                    <td>
                      <div class="ref-badge">${escapeLabelHtml(p.reference)}</div>
                      <div style="font-weight: 800; font-size: 11px;">${escapeLabelHtml(p.brand)} ${escapeLabelHtml(p.model)}</div>
                      ${p.manufacturer_ref ? `<div class="sub-text">OEM: ${escapeLabelHtml(p.manufacturer_ref)}</div>` : ''}
                    </td>
                    <td>
                      ${img?.barcode ? `<img src="${escapeLabelHtml(img.barcode)}" alt="Barcode" class="barcode-img" />` : `<span style="font-family: monospace; font-size: 9px;">${escapeLabelHtml(p.barcode || p.reference)}</span>`}
                    </td>
                    <td>
                      ${img?.qr ? `<img src="${escapeLabelHtml(img.qr)}" alt="QR" style="width: 44px; height: 44px; object-fit: contain;" />` : ''}
                    </td>
                    <td>
                      <div style="font-weight: 700;">${escapeLabelHtml(p.store_name || 'Dépôt Principal')}</div>
                      <div class="sub-text">${escapeLabelHtml(p.room_name || '')} &gt; ${escapeLabelHtml(p.shelf_name || '')}</div>
                    </td>
                    <td style="text-align: center; font-weight: 800;">${escapeLabelHtml(p.quantity)}</td>
                    ${canViewPrices ? `<td style="font-weight: 800;">${escapeLabelHtml(formatCurrency(p.unit_price))}</td>` : ''}
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (modalFormat === 'avery_3x8') {
    sheetContent = `
      <div class="grid-avery_3x8">
        ${itemsToPrint
          .map((p) => {
            const img = imagesCache[p.id];
            const locText = [p.store_name, p.rack_location || p.shelf_name || p.room_name]
              .filter(Boolean)
              .join(' > ');
            return `
              <div class="label-cell">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 4px;">
                  <div style="min-width: 0; flex: 1;">
                    <div class="ref-badge">${escapeLabelHtml(p.reference)}</div>
                    <div class="title-text">${escapeLabelHtml(p.brand)} ${escapeLabelHtml(p.model)}</div>
                    ${showOem && p.manufacturer_ref ? `<div class="sub-text">OEM: ${escapeLabelHtml(p.manufacturer_ref)}</div>` : ''}
                  </div>
                  ${showQr && img?.qr ? `<img src="${escapeLabelHtml(img.qr)}" class="qr-img" />` : ''}
                </div>
                ${showBarcode && img?.barcode ? `<div style="margin: 2px 0;"><img src="${escapeLabelHtml(img.barcode)}" class="barcode-img" /></div>` : ''}
                <div style="display: flex; justify-content: space-between; font-size: 8px; color: #64748b; border-top: 1px solid #f1f5f9; padding-top: 2px;">
                  ${showLocation ? `<span class="tag-loc">📍 ${escapeLabelHtml(locText || p.store_name || '')}</span>` : '<span></span>'}
                  ${effectiveShowPrice ? `<span style="font-weight: 800; color: #0f172a;">${escapeLabelHtml(formatCurrency(p.unit_price))}</span>` : ''}
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  } else if (modalFormat === 'avery_2x7') {
    sheetContent = `
      <div class="grid-avery_2x7">
        ${itemsToPrint
          .map((p) => {
            const img = imagesCache[p.id];
            return `
              <div class="label-cell">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px;">
                  <div style="min-width: 0; flex: 1;">
                    <div class="ref-badge" style="font-size: 13px;">${escapeLabelHtml(p.reference)}</div>
                    <div class="title-text" style="font-size: 11px;">${escapeLabelHtml(p.brand)} ${escapeLabelHtml(p.model)}</div>
                    ${showOem && p.manufacturer_ref ? `<div class="sub-text">Réf: ${escapeLabelHtml(p.manufacturer_ref)}</div>` : ''}
                    ${showLocation ? `<div class="tag-loc" style="margin-top: 3px;">📍 ${escapeLabelHtml(p.store_name || '')} &gt; ${escapeLabelHtml(p.rack_location || p.shelf_name || '')}</div>` : ''}
                  </div>
                  ${showQr && img?.qr ? `<img src="${escapeLabelHtml(img.qr)}" style="width: 52px; height: 52px; object-fit: contain;" />` : ''}
                </div>
                ${showBarcode && img?.barcode ? `<div style="margin: 3px 0; text-align: center;"><img src="${escapeLabelHtml(img.barcode)}" class="barcode-img" style="margin: 0 auto;" /></div>` : ''}
                <div style="display: flex; justify-content: space-between; font-size: 9px; color: #475569; border-top: 1px solid #e2e8f0; padding-top: 3px;">
                  <span>TOT PRO</span>
                  ${effectiveShowPrice ? `<span style="font-weight: 800; color: #0f172a;">PU HT : ${escapeLabelHtml(formatCurrency(p.unit_price))}</span>` : ''}
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  } else if (modalFormat === 'bin_rack') {
    sheetContent = `
      <div class="grid-bin_rack">
        ${itemsToPrint
          .map((p) => {
            const img = imagesCache[p.id];
            return `
              <div class="label-cell">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                  <div style="min-width: 0; flex: 1;">
                    <div class="ref-badge" style="font-size: 15px; background: #ea580c; color: #fff; padding: 2px 8px; border-radius: 4px; display: inline-block;">${escapeLabelHtml(p.reference)}</div>
                    <div class="title-text" style="font-size: 13px; margin-top: 4px;">${escapeLabelHtml(p.brand)} ${escapeLabelHtml(p.model)}</div>
                    ${showLocation ? `<div class="tag-loc" style="font-size: 11px; margin-top: 4px; color: #0369a1;">📍 ${escapeLabelHtml(p.store_name || '')} &bull; ${escapeLabelHtml(p.rack_location || p.shelf_name || p.room_name || 'Casier')}</div>` : ''}
                    ${showOem && p.manufacturer_ref ? `<div class="sub-text" style="font-size: 10px;">Réf. Fab: ${escapeLabelHtml(p.manufacturer_ref)}</div>` : ''}
                  </div>
                  ${showQr && img?.qr ? `<img src="${escapeLabelHtml(img.qr)}" style="width: 65px; height: 65px; object-fit: contain;" />` : ''}
                </div>
                ${showBarcode && img?.barcode ? `<div style="margin: 4px 0; text-align: center;"><img src="${escapeLabelHtml(img.barcode)}" class="barcode-img" style="max-height: 28px; margin: 0 auto;" /></div>` : ''}
                <div style="display: flex; justify-content: space-between; font-size: 10px; color: #334155; border-top: 1px solid #cbd5e1; padding-top: 3px; font-weight: 700;">
                  <span>CASIER / BAC MAGASIN</span>
                  ${effectiveShowPrice ? `<span>${escapeLabelHtml(formatCurrency(p.unit_price))}</span>` : ''}
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  } else {
    sheetContent = `
      <div class="grid-thermal">
        ${itemsToPrint
          .map((p) => {
            const img = imagesCache[p.id];
            return `
              <div class="label-cell">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 4px;">
                  <div style="min-width: 0; flex: 1;">
                    <div class="ref-badge" style="font-size: 11px;">${escapeLabelHtml(p.reference)}</div>
                    <div class="title-text" style="font-size: 9px;">${escapeLabelHtml(p.brand)} ${escapeLabelHtml(p.model)}</div>
                  </div>
                  ${showQr && img?.qr ? `<img src="${escapeLabelHtml(img.qr)}" style="width: 36px; height: 36px; object-fit: contain;" />` : ''}
                </div>
                ${showBarcode && img?.barcode ? `<img src="${escapeLabelHtml(img.barcode)}" class="barcode-img" style="max-height: 20px; margin: 2px auto;" />` : ''}
                <div style="display: flex; justify-content: space-between; font-size: 7px; color: #475569;">
                  ${showLocation ? `<span>📍 ${escapeLabelHtml(p.store_name || '')}</span>` : '<span></span>'}
                  ${effectiveShowPrice ? `<span style="font-weight: 800;">${escapeLabelHtml(formatCurrency(p.unit_price))}</span>` : ''}
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  }

  return sanitizeLabelSheetHtml(sheetContent);
}

/**
 * Génère le fragment HTML d'une étiquette de commande prête ("order_label") :
 * numéro de commande, chantier, demandeur, emplacement de retrait et QR TOT-ORDER:<numéro>.
 */
export function renderOrderReadyLabelSheetHtml(
  orderData: OrderReadyLabelData,
  format: AnyLabelFormat = 'bin_90x50',
  copies = 1
): string {
  const safeCount = Math.min(Math.max(Math.trunc(Number(copies) || 1), 1), 100);
  const modalFormat = toModalLabelFormat(format);
  const gridClass =
    modalFormat === 'avery_3x8'
      ? 'grid-avery_3x8'
      : modalFormat === 'avery_2x7'
      ? 'grid-avery_2x7'
      : modalFormat === 'thermal'
      ? 'grid-thermal'
      : 'grid-bin_rack';

  const safeOrderNum = escapeLabelHtml(orderData.order_number || '');
  const safeSiteNum = escapeLabelHtml(orderData.site_number || '');
  const safeSiteName = escapeLabelHtml(orderData.site_name || '');
  const safeSiteLabel =
    safeSiteNum && safeSiteName
      ? `${safeSiteNum} — ${safeSiteName}`
      : safeSiteNum || safeSiteName || '—';
  const safeRequester = escapeLabelHtml(orderData.requester_name || '—');
  const safePickupZone = escapeLabelHtml(orderData.pickup_zone || 'Zone Retrait');
  const safeDepot = escapeLabelHtml(orderData.depot_name || '');
  const safeQr = orderData.qrDataUrl ? escapeLabelHtml(orderData.qrDataUrl) : '';
  const qrPayloadText = escapeLabelHtml(`TOT-ORDER:${orderData.order_number || ''}`);

  const cells: string[] = [];
  for (let i = 0; i < safeCount; i++) {
    if (modalFormat === 'thermal') {
      cells.push(`
        <div class="label-cell">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 4px;">
            <div style="min-width: 0; flex: 1;">
              <div class="ref-badge" style="font-size: 11px;">CMD ${safeOrderNum}</div>
              <div class="title-text" style="font-size: 9px;">Chantier: ${safeSiteLabel}</div>
              <div class="sub-text" style="font-size: 8px; color: #0f172a; font-weight: 700;">Demandeur: ${safeRequester}</div>
              <div class="tag-loc" style="font-size: 8px; margin-top: 2px; font-weight: 800;">📍 Retrait: ${safePickupZone}</div>
            </div>
            ${safeQr ? `<img src="${safeQr}" alt="${qrPayloadText}" style="width: 42px; height: 42px; object-fit: contain;" />` : ''}
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 7px; color: #475569; border-top: 1px solid #cbd5e1; padding-top: 2px;">
            <span>${qrPayloadText}</span>
            <span>${safeDepot}</span>
          </div>
        </div>
      `);
    } else if (modalFormat === 'avery_3x8') {
      cells.push(`
        <div class="label-cell">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 4px;">
            <div style="min-width: 0; flex: 1;">
              <div class="ref-badge">COMMANDE ${safeOrderNum}</div>
              <div class="title-text">Chantier: ${safeSiteLabel}</div>
              <div class="sub-text" style="color: #0f172a; font-weight: 700;">Demandeur: ${safeRequester}</div>
              <div class="tag-loc" style="margin-top: 2px; font-weight: 800;">📍 Retrait: ${safePickupZone}</div>
            </div>
            ${safeQr ? `<img src="${safeQr}" alt="${qrPayloadText}" class="qr-img" />` : ''}
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 8px; color: #64748b; border-top: 1px solid #f1f5f9; padding-top: 2px;">
            <span>${qrPayloadText}</span>
            <span style="font-weight: 800; color: #0f172a;">${safeDepot}</span>
          </div>
        </div>
      `);
    } else {
      cells.push(`
        <div class="label-cell">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <div style="min-width: 0; flex: 1;">
              <div class="ref-badge" style="font-size: 14px; background: #ea580c; color: #fff; padding: 2px 8px; border-radius: 4px; display: inline-block;">COMMANDE PRÊTE • ${safeOrderNum}</div>
              <div class="title-text" style="font-size: 12px; margin-top: 4px;">Chantier : ${safeSiteLabel}</div>
              <div class="sub-text" style="font-size: 10px; color: #0f172a; font-weight: 700; margin-top: 2px;">Demandeur : ${safeRequester}</div>
              <div class="tag-loc" style="font-size: 11px; margin-top: 4px; color: #0369a1; font-weight: 800;">📍 Zone de retrait : ${safePickupZone}</div>
            </div>
            ${safeQr ? `<img src="${safeQr}" alt="${qrPayloadText}" style="width: 64px; height: 64px; object-fit: contain;" />` : ''}
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 9px; color: #334155; border-top: 1px solid #cbd5e1; padding-top: 3px; font-weight: 700;">
            <span>${qrPayloadText}</span>
            <span>${safeDepot || 'COMMANDE PRÊTE À RETIRER'}</span>
          </div>
        </div>
      `);
    }
  }

  return sanitizeLabelSheetHtml(`<div class="${gridClass}">${cells.join('')}</div>`);
}

/**
 * Construit le document HTML autonome complet avec la feuille de style d'impression A4 ou thermique.
 */
export function buildFullPrintableDocumentHtml(
  sheetInnerHtml: string,
  format: AnyLabelFormat,
  title = "Planche d'Étiquettes TOT Stock PRO"
): string {
  const safeSheetContent = sanitizeLabelSheetHtml(sheetInnerHtml);
  if (!safeSheetContent) return '';

  const modalFormat = toModalLabelFormat(format);
  const isThermal = modalFormat === 'thermal';
  const pageStyle = isThermal
    ? '@page { size: 50mm 30mm; margin: 1mm; }'
    : '@page { size: A4 portrait; margin: 8mm 5mm; }';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <title>${escapeLabelHtml(title)}</title>
  <meta charset="utf-8" />
  <style>
    ${pageStyle}
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body {
      margin: 0;
      padding: 10px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #fff;
      color: #000;
    }
    .print-control-bar {
      margin-bottom: 16px;
      padding: 12px 16px;
      background: #f7ecdf;
      border: 2px solid #ea580c;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-family: sans-serif;
    }
    .print-btn {
      background: #ea580c;
      color: #fff;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      font-weight: bold;
      font-size: 13px;
      cursor: pointer;
    }
    @media print {
      body { padding: 0 !important; }
      .print-control-bar { display: none !important; }
    }
    /* Avery 3x8: 24 labels (approx 70mm x 37mm) */
    .grid-avery_3x8 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2mm 3mm;
      width: 100%;
    }
    .grid-avery_3x8 .label-cell {
      border: 1px dashed #ccc;
      border-radius: 4px;
      padding: 4px 6px;
      height: 35.5mm;
      max-height: 35.5mm;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      page-break-inside: avoid;
      background: #fff;
    }
    /* Avery 2x7: 14 labels (approx 105mm x 42mm) */
    .grid-avery_2x7 {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 2mm 4mm;
      width: 100%;
    }
    .grid-avery_2x7 .label-cell {
      border: 1px dashed #ccc;
      border-radius: 4px;
      padding: 6px 8px;
      height: 40mm;
      max-height: 40mm;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      page-break-inside: avoid;
      background: #fff;
    }
    /* Thermal 50x30mm */
    .grid-thermal {
      display: flex;
      flex-direction: column;
      gap: 2mm;
      width: 48mm;
      margin: 0 auto;
    }
    .grid-thermal .label-cell {
      border: 1px solid #ddd;
      border-radius: 3px;
      padding: 3px 4px;
      height: 28mm;
      max-height: 28mm;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      page-break-inside: avoid;
      page-break-after: always;
      background: #fff;
    }
    /* Bin Rack 90x50mm (Casiers & Bacs de Retrait) */
    .grid-bin_rack {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 5mm;
      width: 100%;
    }
    .grid-bin_rack .label-cell {
      border: 2px solid #0f172a;
      border-radius: 6px;
      padding: 8px 10px;
      height: 48mm;
      max-height: 48mm;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      page-break-inside: avoid;
      background: #fff;
    }
    /* Catalog Table */
    .catalog-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }
    .catalog-table th {
      background-color: #f1f5f9;
      border: 1px solid #cbd5e1;
      padding: 6px;
      text-align: left;
      font-weight: 800;
    }
    .catalog-table td {
      border: 1px solid #e2e8f0;
      padding: 6px;
      vertical-align: middle;
    }
    .ref-badge {
      font-size: 11px;
      font-weight: 900;
      color: #ea580c;
    }
    .title-text {
      font-size: 10px;
      font-weight: 800;
      color: #0f172a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.2;
    }
    .sub-text {
      font-size: 8px;
      color: #64748b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tag-loc {
      font-size: 8px;
      background: #f1f5f9;
      color: #334155;
      padding: 1px 4px;
      border-radius: 3px;
      display: inline-block;
    }
    .barcode-img {
      max-height: 26px;
      max-width: 100%;
      object-fit: contain;
      display: block;
    }
    .qr-img {
      width: 48px;
      height: 48px;
      display: block;
      flex-shrink: 0;
    }
  </style>
</head>
<body>
  <div class="print-control-bar">
    <div>
      <strong style="color: #7c2d12; font-size: 14px;">📄 ${escapeLabelHtml(title)}</strong>
      <div style="font-size: 12px; color: #9a3412;">Format sélectionné : ${escapeLabelHtml(modalFormat)}. Prêt pour impression A4 ou thermique.</div>
    </div>
    <button class="print-btn" onclick="window.print()">🖨️ Imprimer / Enregistrer en PDF</button>
  </div>
  ${safeSheetContent}
</body>
</html>`;
}

/**
 * Lance l'impression directe dans le navigateur via #tot-direct-printable-sheet.
 */
export function triggerDirectBrowserPrint(fullDocumentHtml: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      resolve({ ok: false, error: 'Environnement navigateur indisponible' });
      return;
    }

    if (!fullDocumentHtml || !fullDocumentHtml.trim()) {
      resolve({ ok: false, error: "Contenu d'étiquette vide" });
      return;
    }

    const prevSheet = document.getElementById('tot-direct-printable-sheet');
    if (prevSheet) {
      prevSheet.remove();
    }

    const printContainer = document.createElement('div');
    printContainer.id = 'tot-direct-printable-sheet';

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(fullDocumentHtml, 'text/html');

      const styles = doc.head.querySelectorAll('style');
      styles.forEach((s) => printContainer.appendChild(s.cloneNode(true)));

      Array.from(doc.body.childNodes).forEach((n) => {
        if (
          n.nodeType === Node.ELEMENT_NODE &&
          (n as HTMLElement).classList.contains('print-control-bar')
        ) {
          return;
        }
        printContainer.appendChild(n.cloneNode(true));
      });

      document.body.appendChild(printContainer);
      document.body.classList.add('is-printing-direct-sheet');

      setTimeout(() => {
        let printOk = true;
        let printError: string | undefined;
        try {
          window.focus();
          window.print();
        } catch (err: any) {
          printOk = false;
          printError = err?.message || "Erreur lors de l'appel à window.print()";
        } finally {
          setTimeout(() => {
            document.body.classList.remove('is-printing-direct-sheet');
            if (printContainer.parentNode) {
              printContainer.remove();
            }
            resolve({ ok: printOk, error: printError });
          }, 800);
        }
      }, 250);
    } catch (parseErr: any) {
      resolve({ ok: false, error: parseErr?.message || "Erreur de préparation de l'impression" });
    }
  });
}
