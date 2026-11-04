import { OrderReadyLabelData } from './labelRendering';
import { Product } from '../types';

export type ZplFormatMm = '50x30' | '70x37' | '90x50';
export type ZplDpi = 203 | 300;

export interface ZplPrinterOptions {
  format?: ZplFormatMm;
  dpi?: ZplDpi;
  copies?: number;
  offsetXMm?: number;
  offsetYMm?: number;
  speed?: number; // 2..8
  darkness?: number; // 0..30
}

/**
 * Convertit des millimètres en points (dots) selon la résolution de la tête thermique (203 ou 300 dpi).
 * 203 dpi ≈ 8 dots/mm ; 300 dpi ≈ 11.811 dots/mm (souvent arrondi à 12 dots/mm sur Zebra, ou exact 300/25.4).
 */
export function mmToDots(mm: number, dpi: ZplDpi = 203): number {
  const safeMm = Number.isFinite(mm) ? mm : 0;
  const dotsPerMm = dpi === 300 ? 300 / 25.4 : 203.2 / 25.4;
  return Math.round(safeMm * dotsPerMm);
}

/**
 * Nettoie et échappe une chaîne pour ZPL II avec `^FH\` activé :
 * - Supprime les caractères de contrôle ASCII (< 32)
 * - Échappe `\`, `^` et `~` en séquences hexadécimales `\5C`, `\5E`, `\7E`
 *   pour empêcher toute injection de commandes ZPL (`^XZ`, `~JA`, etc.).
 */
export function sanitizeZplField(raw: unknown, maxLength = 80): string {
  if (raw === null || raw === undefined) return '';
  const cleaned = String(raw)
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .trim()
    .slice(0, maxLength);

  return cleaned
    .replace(/\\/g, '\\5C')
    .replace(/\^/g, '\\5E')
    .replace(/~/g, '\\7E');
}

/**
 * Dimensions en millimètres des formats supportés par le générateur ZPL.
 */
export function getZplFormatDimensionsMm(format: ZplFormatMm = '50x30'): {
  widthMm: number;
  heightMm: number;
} {
  switch (format) {
    case '70x37':
      return { widthMm: 70, heightMm: 37 };
    case '90x50':
      return { widthMm: 90, heightMm: 50 };
    case '50x30':
    default:
      return { widthMm: 50, heightMm: 30 };
  }
}

function buildZplHeader(options: ZplPrinterOptions = {}): {
  header: string;
  footer: string;
  dpi: ZplDpi;
  widthDots: number;
  heightDots: number;
} {
  const dpi: ZplDpi = options.dpi === 300 ? 300 : 203;
  const format: ZplFormatMm = options.format || '50x30';
  const { widthMm, heightMm } = getZplFormatDimensionsMm(format);
  const widthDots = mmToDots(widthMm, dpi);
  const heightDots = mmToDots(heightMm, dpi);

  const offsetXDots = mmToDots(Math.max(-10, Math.min(10, Number(options.offsetXMm) || 0)), dpi);
  const offsetYDots = mmToDots(Math.max(-10, Math.min(10, Number(options.offsetYMm) || 0)), dpi);
  const copies = Math.max(1, Math.min(100, Math.trunc(Number(options.copies) || 1)));

  const lines: string[] = [
    '^XA',
    '^CI28', // Encodage UTF-8 (accents français/néerlandais)
    `^PW${widthDots}`,
    `^LL${heightDots}`,
    `^LH${ Math.max(0, offsetXDots) },${ Math.max(0, offsetYDots) }`,
  ];

  if (options.speed !== undefined && Number.isFinite(options.speed)) {
    const spd = Math.max(2, Math.min(12, Math.trunc(options.speed)));
    lines.push(`^PR${spd}`);
  }
  if (options.darkness !== undefined && Number.isFinite(options.darkness)) {
    const drk = Math.max(0, Math.min(30, Math.trunc(options.darkness)));
    lines.push(`~SD${String(drk).padStart(2, '0')}`);
  }

  const footer = `^PQ${copies},0,1,Y\n^XZ`;
  return {
    header: lines.join('\n'),
    footer,
    dpi,
    widthDots,
    heightDots,
  };
}

/**
 * Génère le code ZPL II d'une étiquette produit (référence, désignation, emplacement, Code 128 et QR code).
 */
export function generateProductZplLabel(
  product: Pick<
    Product,
    | 'reference'
    | 'brand'
    | 'model'
    | 'barcode'
    | 'qr_code'
    | 'store_name'
    | 'room_name'
    | 'shelf_name'
    | 'rack_location'
  >,
  options: ZplPrinterOptions = {}
): string {
  const { header, footer, dpi, widthDots, heightDots } = buildZplHeader(options);
  const scale = dpi === 300 ? 1.5 : 1;

  const ref = sanitizeZplField(product.reference, 36);
  const title = sanitizeZplField(`${product.brand || ''} ${product.model || ''}`.trim(), 48);
  const loc = sanitizeZplField(
    [product.store_name, product.rack_location || product.shelf_name || product.room_name]
      .filter(Boolean)
      .join(' > '),
    42
  );
  const barcodeVal = sanitizeZplField(product.barcode || product.reference, 32);
  const qrPayload = sanitizeZplField(product.qr_code || `TOT-PROD:${product.reference}`, 64);

  const pad = Math.round(14 * scale);
  const refFontH = Math.round(28 * scale);
  const titleFontH = Math.round(20 * scale);
  const locFontH = Math.round(18 * scale);
  const bcHeight = Math.round(44 * scale);
  const qrMag = dpi === 300 ? 5 : 4;
  const qrX = Math.max(pad + 180, widthDots - Math.round(125 * scale));

  const body = [
    `^FO${pad},${pad}^A0N,${refFontH},${refFontH}^FH\\^FD${ref}^FS`,
    `^FO${pad},${pad + refFontH + 6}^A0N,${titleFontH},${titleFontH}^FH\\^FD${title}^FS`,
    loc
      ? `^FO${pad},${pad + refFontH + titleFontH + 14}^A0N,${locFontH},${locFontH}^FH\\^FD${loc}^FS`
      : '',
    `^FO${pad},${Math.max(pad + refFontH + titleFontH + 38, heightDots - bcHeight - Math.round(34 * scale))}^BY${dpi === 300 ? 2 : 2},2,${bcHeight}^BCN,${bcHeight},Y,N,N^FH\\^FD${barcodeVal}^FS`,
    `^FO${qrX},${pad}^BQN,2,${qrMag}^FH\\^FDLA,${qrPayload}^FS`,
  ]
    .filter(Boolean)
    .join('\n');

  return `${header}\n${body}\n${footer}`;
}

/**
 * Génère le code ZPL II d'une étiquette « Commande prête » (`TOT-ORDER:<numéro>`).
 */
export function generateOrderReadyZplLabel(
  order: OrderReadyLabelData,
  options: ZplPrinterOptions = {}
): string {
  const { header, footer, dpi, widthDots } = buildZplHeader(options);
  const scale = dpi === 300 ? 1.5 : 1;

  const orderNum = sanitizeZplField(order.order_number, 36);
  const site = sanitizeZplField(
    [order.site_number, order.site_name].filter(Boolean).join(' - '),
    42
  );
  const requester = sanitizeZplField(order.requester_name || '', 36);
  const pickupZone = sanitizeZplField(order.pickup_zone || 'Zone Retrait', 32);
  const qrPayload = sanitizeZplField(`TOT-ORDER:${order.order_number}`, 64);

  const pad = Math.round(14 * scale);
  const h1 = Math.round(26 * scale);
  const h2 = Math.round(20 * scale);
  const qrMag = dpi === 300 ? 6 : 4;
  const qrX = Math.max(pad + 190, widthDots - Math.round(135 * scale));

  const body = [
    `^FO${pad},${pad}^A0N,${h1},${h1}^FH\\^FDCMD: ${orderNum}^FS`,
    site ? `^FO${pad},${pad + h1 + 8}^A0N,${h2},${h2}^FH\\^FDChantier: ${site}^FS` : '',
    requester
      ? `^FO${pad},${pad + h1 + h2 + 16}^A0N,${h2},${h2}^FH\\^FDDemandeur: ${requester}^FS`
      : '',
    `^FO${pad},${pad + h1 + h2 * 2 + 26}^GB${Math.round(180 * scale)},${Math.round(32 * scale)},2^FS`,
    `^FO${pad + 8},${pad + h1 + h2 * 2 + 32}^A0N,${h2},${h2}^FH\\^FDRETRAIT: ${pickupZone}^FS`,
    `^FO${qrX},${pad}^BQN,2,${qrMag}^FH\\^FDLA,${qrPayload}^FS`,
  ]
    .filter(Boolean)
    .join('\n');

  return `${header}\n${body}\n${footer}`;
}

/**
 * Génère le code ZPL II d'une étiquette de bac / étagère (grand format 90x50 par défaut).
 */
export function generateBinRackZplLabel(
  params: {
    locationCode: string;
    depotName?: string;
    productRef?: string;
    productTitle?: string;
  },
  options: ZplPrinterOptions = {}
): string {
  const effectiveOptions: ZplPrinterOptions = {
    ...options,
    format: options.format || '90x50',
  };
  const { header, footer, dpi, widthDots } = buildZplHeader(effectiveOptions);
  const scale = dpi === 300 ? 1.5 : 1;

  const loc = sanitizeZplField(params.locationCode, 28);
  const depot = sanitizeZplField(params.depotName || 'Depot Principal', 36);
  const ref = sanitizeZplField(params.productRef || '', 32);
  const title = sanitizeZplField(params.productTitle || '', 44);
  const qrPayload = sanitizeZplField(params.productRef ? `TOT-PROD:${params.productRef}` : loc, 64);

  const pad = Math.round(18 * scale);
  const bigFont = Math.round(44 * scale);
  const medFont = Math.round(24 * scale);
  const qrMag = dpi === 300 ? 7 : 5;
  const qrX = Math.max(pad + 240, widthDots - Math.round(160 * scale));

  const body = [
    `^FO${pad},${pad}^A0N,${medFont},${medFont}^FH\\^FD${depot}^FS`,
    `^FO${pad},${pad + medFont + 10}^A0N,${bigFont},${bigFont}^FH\\^FD${loc}^FS`,
    ref ? `^FO${pad},${pad + medFont + bigFont + 20}^A0N,${medFont},${medFont}^FH\\^FD${ref}^FS` : '',
    title
      ? `^FO${pad},${pad + medFont * 2 + bigFont + 28}^A0N,${medFont},${medFont}^FH\\^FD${title}^FS`
      : '',
    `^FO${qrX},${pad}^BQN,2,${qrMag}^FH\\^FDLA,${qrPayload}^FS`,
  ]
    .filter(Boolean)
    .join('\n');

  return `${header}\n${body}\n${footer}`;
}

export const ALLOWED_ZPL_PORTS = [9100, 9101, 9102] as const;

/**
 * Valide l'adresse réseau et le port d'une imprimante Zebra ZPL (protection anti-SSRF v34) :
 * - Autorise uniquement les adresses IPv4 privées RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
 * - Refuse `169.254.x.x`, `127.0.0.1`, `0.0.0.0`, `localhost`, toute IPv4 publique et tout nom d'hôte.
 * - Autorise uniquement les ports `[9100, 9101, 9102]` (défaut `9100`).
 */
export function validateZplPrinterAddress(
  host: unknown,
  port: unknown = 9100
): { valid: boolean; host?: string; port?: number; error?: string } {
  if (typeof host !== 'string' || !host.trim()) {
    return { valid: false, error: "Adresse d'imprimante manquante" };
  }
  const cleanHost = host.trim();

  const numPort = Number(port);
  if (!Number.isInteger(numPort) || !ALLOWED_ZPL_PORTS.includes(numPort as 9100 | 9101 | 9102)) {
    return {
      valid: false,
      error: `Port non autorisé (${String(port)}). Ports permis : 9100, 9101, 9102.`,
    };
  }

  if (/^localhost$/i.test(cleanHost)) {
    return { valid: false, error: 'Adresse localhost interdite' };
  }

  const ipv4Match = cleanHost.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) {
    return {
      valid: false,
      error:
        "Noms d'hôtes refusés (utilisez uniquement une adresse IPv4 privée RFC 1918, ex. 192.168.1.50)",
    };
  }

  const octets = [
    Number(ipv4Match[1]),
    Number(ipv4Match[2]),
    Number(ipv4Match[3]),
    Number(ipv4Match[4]),
  ];
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
    return { valid: false, error: 'Adresse IPv4 invalide' };
  }
  const [a, b] = octets;
  const isPrivate10 = a === 10;
  const isPrivate172 = a === 172 && b >= 16 && b <= 31;
  const isPrivate192 = a === 192 && b === 168;

  if (!isPrivate10 && !isPrivate172 && !isPrivate192) {
    return {
      valid: false,
      error: 'Seules les adresses IPv4 privées RFC 1918 (10.x, 172.16-31.x, 192.168.x) sont autorisées',
    };
  }

  return { valid: true, host: cleanHost, port: numPort };
}

