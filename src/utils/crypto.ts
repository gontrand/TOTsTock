// Cryptographically secure helper using PBKDF2 with SHA-256 and salt for PIN protection
export async function hashPin(pin: string, customSaltHex?: string): Promise<string> {
  const trimmed = pin.trim();
  if (!trimmed) return '';

  try {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      // 16 bytes (128 bits) cryptographically secure salt
      let salt: Uint8Array;
      if (customSaltHex && /^[0-9a-fA-F]{32}$/.test(customSaltHex)) {
        const matches = customSaltHex.match(/.{1,2}/g) || [];
        salt = new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
      } else {
        salt = new Uint8Array(16);
        window.crypto.getRandomValues(salt as any);
      }

      const saltHex = Array.from(salt)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const enc = new TextEncoder();
      const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(trimmed),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
      );

      const iterations = 100000;
      const derivedBits = await window.crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: salt as any,
          iterations,
          hash: 'SHA-256',
        },
        keyMaterial,
        256
      );

      const hashHex = Array.from(new Uint8Array(derivedBits))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      return `pbkdf2$${iterations}$${saltHex}$${hashHex}`;
    }

    // Fallback if Web Crypto is unavailable
    return `hash_${trimmed}`;
  } catch (err) {
    console.warn('Error in secure hashPin, falling back:', err);
    return `hash_${trimmed}`;
  }
}

/**
 * Verifies a raw PIN against a stored hash (PBKDF2, legacy SHA-256, or raw).
 * Returns { match: boolean, needsRehash: boolean } to allow seamless database upgrades.
 */
export async function verifyPin(
  rawPin: string,
  storedValue: string | undefined | null
): Promise<{ match: boolean; needsRehash: boolean }> {
  if (!storedValue || !rawPin) return { match: false, needsRehash: false };
  const trimmedInput = rawPin.trim();
  const trimmedStored = String(storedValue).trim();

  // 1. Modern PBKDF2 hash: pbkdf2$iterations$salt$hash
  if (trimmedStored.startsWith('pbkdf2$')) {
    const parts = trimmedStored.split('$');
    if (parts.length === 4) {
      const saltHex = parts[2];
      const expectedHashHex = parts[3];
      const recomputed = await hashPin(trimmedInput, saltHex);
      const recomputedParts = recomputed.split('$');
      return {
        match: recomputedParts[3] === expectedHashHex,
        needsRehash: false,
      };
    }
  }

  // 2. Legacy SHA-256 unsalted hash (64 hex characters)
  if (/^[0-9a-fA-F]{64}$/.test(trimmedStored)) {
    try {
      const msgUint8 = new TextEncoder().encode(trimmedInput);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      if (hashHex.toLowerCase() === trimmedStored.toLowerCase()) {
        return { match: true, needsRehash: true }; // Upgrade to PBKDF2 on next save
      }
    } catch {
      // Fallback
    }
  }

  // 3. Plaintext fallback (e.g. initial demo/seed data)
  if (trimmedStored === trimmedInput || trimmedStored === `hash_${trimmedInput}`) {
    return { match: true, needsRehash: true };
  }

  return { match: false, needsRehash: false };
}

/**
 * Local device PIN storage (Salted PBKDF2 stored only in browser localStorage, NEVER in database)
 */
export async function saveLocalDevicePin(userId: string | number, pin: string): Promise<boolean> {
  try {
    const hashed = await hashPin(pin);
    localStorage.setItem(`tot_local_device_pin_${userId}`, hashed);
    return true;
  } catch {
    return false;
  }
}

export async function verifyLocalDevicePin(userId: string | number, pin: string): Promise<boolean> {
  try {
    const stored = localStorage.getItem(`tot_local_device_pin_${userId}`);
    if (!stored) return false;
    const { match } = await verifyPin(pin, stored);
    return match;
  } catch {
    return false;
  }
}

export function hasLocalDevicePin(userId: string | number): boolean {
  try {
    return Boolean(localStorage.getItem(`tot_local_device_pin_${userId}`));
  } catch {
    return false;
  }
}

export function clearLocalDevicePin(userId: string | number): void {
  try {
    localStorage.removeItem(`tot_local_device_pin_${userId}`);
  } catch {
    // Ignore
  }
}

/**
 * Generates cryptographically secure random hexadecimal characters.
 * Replaces Math.random() in secure tokens and license generation.
 */
export function generateSecureRandomHex(bytes = 8): string {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const arr = new Uint8Array(bytes);
    window.crypto.getRandomValues(arr);
    return Array.from(arr)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  // Fallback using crypto.randomUUID
  return crypto.randomUUID().replace(/-/g, '').substring(0, bytes * 2).toUpperCase();
}

import { hapticFeedback, getUnlockedAudioContext, isSoundEnabled } from './haptics';

// Audio beep synthesizer for scanner success / error (Scan, Entrée & Sortie — toujours actif)
export function playScanBeep(success: boolean = true) {
  try {
    if (success) {
      hapticFeedback.scanSuccess();
    } else {
      hapticFeedback.scanError();
    }
  } catch {}
  try {
    const ctx = getUnlockedAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (success) {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.08); // A6
      gain.gain.setValueAtTime(0.22, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.12);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.32, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.22);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.22);
    }
  } catch {
    // audio context might be restricted before user gesture
  }
}

// Audio beep synthesizer for incoming warehouse orders (two-tone chime)
export function playNewOrderBeep() {
  try {
    hapticFeedback.heavy();
  } catch {}
  if (!isSoundEnabled()) return;
  try {
    const ctx = getUnlockedAudioContext();
    if (!ctx) return;

    // Note 1: E5 (659.25Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, ctx.currentTime);
    gain1.gain.setValueAtTime(0.22, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.15);

    // Note 2: B5 (987.77Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(987.77, ctx.currentTime + 0.16);
    gain2.gain.setValueAtTime(0.28, ctx.currentTime + 0.16);
    gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.16);
    osc2.stop(ctx.currentTime + 0.4);
  } catch {
    // audio context might be restricted
  }
}

// Generate automatic 3-letter trigram
export function generateTrigram(name: string): string {
  if (!name) return 'USR';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1].substring(0, 2)).toUpperCase();
  } else if (parts[0].length >= 3) {
    return parts[0].substring(0, 3).toUpperCase();
  }
  return parts[0].padEnd(3, 'X').toUpperCase();
}

export interface CurrencyOption {
  code: string;
  symbol: string;
  name: string;
  locale: string;
  flag: string;
}

export const SUPPORTED_CURRENCIES: CurrencyOption[] = [
  { code: 'EUR', symbol: '€', name: 'Euro (€)', locale: 'fr-FR', flag: '🇪🇺' },
  { code: 'USD', symbol: '$', name: 'Dollar Américain ($)', locale: 'en-US', flag: '🇺🇸' },
  { code: 'CHF', symbol: 'CHF', name: 'Franc Suisse (CHF)', locale: 'fr-CH', flag: '🇨🇭' },
  { code: 'GBP', symbol: '£', name: 'Livre Sterling (£)', locale: 'en-GB', flag: '🇬🇧' },
  { code: 'CAD', symbol: '$CA', name: 'Dollar Canadien ($CA)', locale: 'fr-CA', flag: '🇨🇦' },
  { code: 'XOF', symbol: 'CFA', name: 'Franc CFA (XOF)', locale: 'fr-SN', flag: '🌍' },
  { code: 'MAD', symbol: 'DH', name: 'Dirham Marocain (MAD)', locale: 'fr-MA', flag: '🇲🇦' },
  { code: 'DZD', symbol: 'DA', name: 'Dinar Algérien (DZD)', locale: 'fr-DZ', flag: '🇩🇿' },
  { code: 'TND', symbol: 'DT', name: 'Dinar Tunisien (TND)', locale: 'fr-TN', flag: '🇹🇳' },
];

export function getActiveCurrency(): string {
  try {
    return localStorage.getItem('tot_app_currency') || 'EUR';
  } catch {
    return 'EUR';
  }
}

export function setActiveCurrency(code: string): void {
  try {
    localStorage.setItem('tot_app_currency', code);
  } catch {
    // ignore
  }
}

// Format currency dynamically with chosen currency
export function formatCurrency(amount: number, customCurrency?: string): string {
  const code = customCurrency || getActiveCurrency();
  const option = SUPPORTED_CURRENCIES.find((c) => c.code === code) || SUPPORTED_CURRENCIES[0];
  try {
    return new Intl.NumberFormat(option.locale, {
      style: 'currency',
      currency: option.code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount || 0);
  } catch {
    return `${(amount || 0).toFixed(2)} ${option.symbol}`;
  }
}

// Format Date
export function formatDate(dateString?: string): string {
  if (!dateString) return 'Date inconnue';
  try {
    const d = new Date(dateString);
    return d.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateString;
  }
}

// Normalization helper for resilient depot matching (ignores case, spaces, and accents)
const normalizeString = (str?: string | null): string => {
  if (!str) return '';
  return str
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
};

// Check if a user is permitted to access/take items from a specific depot
export function isUserAllowedForDepot(
  user: { id?: string | number; role_id?: number; allowed_depots?: string[] } | null | undefined,
  depotName?: string | null
): boolean {
  if (!user) return false;
  // SuperAdmin (ID 0 or Role 0) has unrestricted access across all depots
  if (Number(user.id) === 0 || Number(user.role_id) === 0) return true;
  // If allowed_depots is undefined, empty, or includes '*', user has unrestricted access
  if (!user.allowed_depots || user.allowed_depots.length === 0 || user.allowed_depots.includes('*')) {
    return true;
  }
  if (!depotName) return true;
  const targetNorm = normalizeString(depotName);
  return user.allowed_depots.some((d) => normalizeString(d) === targetNorm);
}

// Check if a depot is closed/inactive (withdrawals strictly prohibited)
export function isDepotClosed(
  depots: Array<{ id?: string | number; name: string; code?: string; is_active?: boolean; status?: string }> | undefined | null,
  depotName?: string | null
): boolean {
  if (!depots || depots.length === 0) return false;
  
  // If product doesn't explicitly name a store, test against the primary/default depot
  const targetNorm = normalizeString(depotName || depots[0]?.name || 'Dépôt Principal');
  if (!targetNorm) return false;

  const found = depots.find((d) => {
    const dNameNorm = normalizeString(d.name);
    const dCodeNorm = normalizeString(d.code);
    const dIdStr = String(d.id || '').toLowerCase().trim();
    return dNameNorm === targetNorm || dCodeNorm === targetNorm || dIdStr === targetNorm;
  });

  if (!found) return false;

  // Strict check: if marked inactive or closed
  return (
    found.is_active === false ||
    (found as any).is_active === 'false' ||
    (found as any).is_active === 0 ||
    found.status === 'closed' ||
    found.status === 'inactive' ||
    (found as any).status === 'inactif'
  );
}

export * from './depotPermissions';

export interface ProductUniquenessFieldErrors {
  reference?: string;
  manufacturer_ref?: string;
  barcode?: string;
  qr_code?: string;
}

export interface ProductUniquenessResult {
  valid: boolean;
  error?: string;
  fieldErrors: ProductUniquenessFieldErrors;
}

/**
 * Vérifie l'unicité stricte des 4 identifiants d'un article :
 * 1. Référence interne (reference)
 * 2. Identification / Référence Fabricant OEM (manufacturer_ref)
 * 3. Code-barres Fabricant 1D (barcode)
 * 4. Code QR d'inventaire (qr_code)
 *
 * Aucun de ces identifiants ne peut être dupliqué sur un autre article du catalogue
 * (ni entrer en conflit croisé avec la référence, le code-barres, le QR code ou la réf. fabricant d'un autre article).
 */
export function validateProductIdentifiersUniqueness(
  candidate: {
    id?: string;
    reference?: string;
    manufacturer_ref?: string;
    barcode?: string;
    qr_code?: string;
  },
  existingProducts: Array<{
    id: string;
    reference: string;
    manufacturer_ref?: string;
    barcode?: string;
    qr_code?: string;
    brand?: string;
    model?: string;
  }>,
  options?: {
    isNew?: boolean;
    editingId?: string | null;
    language?: 'fr' | 'en' | 'nl';
  }
): ProductUniquenessResult {
  const lang = options?.language || 'fr';
  const isNew = options?.isNew ?? false;
  const editingId = options?.editingId != null ? String(options.editingId).trim().toLowerCase() : null;

  const refRaw = (candidate.reference || '').trim();
  const oemRaw = (candidate.manufacturer_ref || '').trim();
  const barcodeRaw = (candidate.barcode || '').trim();
  const qrRaw = (candidate.qr_code || '').trim();
  const effectiveQrRaw = qrRaw || refRaw;

  const refLower = refRaw.toLowerCase();
  const oemLower = oemRaw.toLowerCase();
  const barcodeLower = barcodeRaw.toLowerCase();
  const qrLower = effectiveQrRaw.toLowerCase();

  const fieldErrors: ProductUniquenessFieldErrors = {};

  // 1. Vérification intra-article (éviter que la référence interne, la réf. fabricant et le code-barres 1D soient identiques entre eux)
  if (refLower && oemLower && refLower === oemLower) {
    fieldErrors.manufacturer_ref =
      lang === 'fr'
        ? `La référence fabricant (« ${oemRaw} ») doit être distincte de la référence interne.`
        : `Manufacturer reference ("${oemRaw}") must be distinct from the internal reference.`;
  }
  if (refLower && barcodeLower && refLower === barcodeLower) {
    fieldErrors.barcode =
      lang === 'fr'
        ? `Le code-barres fabricant (« ${barcodeRaw} ») doit être distinct de la référence interne.`
        : `Manufacturer barcode ("${barcodeRaw}") must be distinct from the internal reference.`;
  }
  if (oemLower && barcodeLower && oemLower === barcodeLower) {
    fieldErrors.barcode =
      lang === 'fr'
        ? `Le code-barres fabricant (« ${barcodeRaw} ») doit être distinct de la référence fabricant (OEM).`
        : `Manufacturer barcode ("${barcodeRaw}") must be distinct from the manufacturer reference (OEM).`;
  }
  if (qrRaw && barcodeLower && qrRaw.toLowerCase() === barcodeLower) {
    fieldErrors.qr_code =
      lang === 'fr'
        ? `Le QR Code (« ${qrRaw} ») doit être distinct du code-barres 1D fabricant.`
        : `QR Code ("${qrRaw}") must be distinct from the 1D manufacturer barcode.`;
  }
  if (qrRaw && oemLower && qrRaw.toLowerCase() === oemLower) {
    fieldErrors.qr_code =
      lang === 'fr'
        ? `Le QR Code (« ${qrRaw} ») doit être distinct de la référence fabricant (OEM).`
        : `QR Code ("${qrRaw}") must be distinct from the manufacturer reference (OEM).`;
  }

  // 2. Vérification inter-articles sur l'ensemble du catalogue
  for (const other of existingProducts) {
    const otherIdLower = String(other.id || '').trim().toLowerCase();
    // En mode édition, ignorer l'article actuellement en cours de modification
    if (!isNew && editingId && otherIdLower === editingId) {
      continue;
    }

    const otherRef = String(other.reference || '').trim();
    const otherOem = String(other.manufacturer_ref || '').trim();
    const otherBarcode = String(other.barcode || '').trim();
    const otherQr = String(other.qr_code || other.reference || '').trim();

    const otherRefLower = otherRef.toLowerCase();
    const otherOemLower = otherOem.toLowerCase();
    const otherBarcodeLower = otherBarcode.toLowerCase();
    const otherQrLower = otherQr.toLowerCase();

    const otherLabel = `${other.brand || ''} ${other.model || ''}`.trim() || otherRef;

    // A. Unicité de la Référence interne
    if (refLower && !fieldErrors.reference) {
      if (refLower === otherRefLower || refLower === otherIdLower) {
        fieldErrors.reference =
          lang === 'fr'
            ? `La référence « ${refRaw} » existe déjà pour l'article « ${otherLabel} » (${otherRef}).`
            : `Reference "${refRaw}" is already used by "${otherLabel}" (${otherRef}).`;
      } else if (otherBarcodeLower && refLower === otherBarcodeLower) {
        fieldErrors.reference =
          lang === 'fr'
            ? `La référence « ${refRaw} » est déjà enregistrée comme code-barres sur « ${otherLabel} » (${otherRef}).`
            : `Reference "${refRaw}" is already used as a barcode on "${otherLabel}" (${otherRef}).`;
      } else if (otherOemLower && refLower === otherOemLower) {
        fieldErrors.reference =
          lang === 'fr'
            ? `La référence « ${refRaw} » est déjà enregistrée comme réf. fabricant sur « ${otherLabel} » (${otherRef}).`
            : `Reference "${refRaw}" is already used as a manufacturer ref on "${otherLabel}" (${otherRef}).`;
      } else if (otherQrLower && refLower === otherQrLower) {
        fieldErrors.reference =
          lang === 'fr'
            ? `La référence « ${refRaw} » est déjà utilisée comme QR Code sur « ${otherLabel} » (${otherRef}).`
            : `Reference "${refRaw}" is already used as a QR Code on "${otherLabel}" (${otherRef}).`;
      }
    }

    // B. Unicité de l'Identification & Référence Fabricant (OEM)
    if (oemLower && !fieldErrors.manufacturer_ref) {
      if (otherOemLower && oemLower === otherOemLower) {
        fieldErrors.manufacturer_ref =
          lang === 'fr'
            ? `L'identification / réf. fabricant « ${oemRaw} » est déjà attribuée à « ${otherLabel} » (${otherRef}).`
            : `Manufacturer ID / OEM ref "${oemRaw}" is already assigned to "${otherLabel}" (${otherRef}).`;
      } else if (oemLower === otherRefLower) {
        fieldErrors.manufacturer_ref =
          lang === 'fr'
            ? `L'identification fabricant « ${oemRaw} » correspond déjà à la référence de « ${otherLabel} » (${otherRef}).`
            : `Manufacturer ID "${oemRaw}" matches the reference of "${otherLabel}" (${otherRef}).`;
      } else if (otherBarcodeLower && oemLower === otherBarcodeLower) {
        fieldErrors.manufacturer_ref =
          lang === 'fr'
            ? `L'identification fabricant « ${oemRaw} » correspond déjà au code-barres de « ${otherLabel} » (${otherRef}).`
            : `Manufacturer ID "${oemRaw}" matches the barcode of "${otherLabel}" (${otherRef}).`;
      } else if (otherQrLower && oemLower === otherQrLower) {
        fieldErrors.manufacturer_ref =
          lang === 'fr'
            ? `L'identification fabricant « ${oemRaw} » correspond déjà au QR Code de « ${otherLabel} » (${otherRef}).`
            : `Manufacturer ID "${oemRaw}" matches the QR Code of "${otherLabel}" (${otherRef}).`;
      }
    }

    // C. Unicité du Code-barres Fabricant 1D
    if (barcodeLower && !fieldErrors.barcode) {
      if (otherBarcodeLower && barcodeLower === otherBarcodeLower) {
        fieldErrors.barcode =
          lang === 'fr'
            ? `Le code-barres fabricant « ${barcodeRaw} » est déjà attribué à « ${otherLabel} » (${otherRef}).`
            : `Manufacturer barcode "${barcodeRaw}" is already assigned to "${otherLabel}" (${otherRef}).`;
      } else if (barcodeLower === otherRefLower) {
        fieldErrors.barcode =
          lang === 'fr'
            ? `Le code-barres « ${barcodeRaw} » est déjà utilisé comme référence par « ${otherLabel} » (${otherRef}).`
            : `Barcode "${barcodeRaw}" is already used as a reference by "${otherLabel}" (${otherRef}).`;
      } else if (otherOemLower && barcodeLower === otherOemLower) {
        fieldErrors.barcode =
          lang === 'fr'
            ? `Le code-barres « ${barcodeRaw} » est déjà utilisé comme réf. fabricant par « ${otherLabel} » (${otherRef}).`
            : `Barcode "${barcodeRaw}" is already used as a manufacturer ref by "${otherLabel}" (${otherRef}).`;
      } else if (otherQrLower && barcodeLower === otherQrLower) {
        fieldErrors.barcode =
          lang === 'fr'
            ? `Le code-barres « ${barcodeRaw} » est déjà utilisé comme QR Code par « ${otherLabel} » (${otherRef}).`
            : `Barcode "${barcodeRaw}" is already used as a QR Code by "${otherLabel}" (${otherRef}).`;
      }
    }

    // D. Unicité du QR Code
    if (qrLower && !fieldErrors.qr_code) {
      if (otherQrLower && qrLower === otherQrLower) {
        fieldErrors.qr_code =
          lang === 'fr'
            ? `Le QR Code « ${effectiveQrRaw} » est déjà attribué à « ${otherLabel} » (${otherRef}).`
            : `QR Code "${effectiveQrRaw}" is already assigned to "${otherLabel}" (${otherRef}).`;
      } else if (qrLower === otherRefLower) {
        fieldErrors.qr_code =
          lang === 'fr'
            ? `Le QR Code « ${effectiveQrRaw} » correspond déjà à la référence de « ${otherLabel} » (${otherRef}).`
            : `QR Code "${effectiveQrRaw}" matches the reference of "${otherLabel}" (${otherRef}).`;
      } else if (otherBarcodeLower && qrLower === otherBarcodeLower) {
        fieldErrors.qr_code =
          lang === 'fr'
            ? `Le QR Code « ${effectiveQrRaw} » correspond déjà au code-barres de « ${otherLabel} » (${otherRef}).`
            : `QR Code "${effectiveQrRaw}" matches the barcode of "${otherLabel}" (${otherRef}).`;
      } else if (otherOemLower && qrLower === otherOemLower) {
        fieldErrors.qr_code =
          lang === 'fr'
            ? `Le QR Code « ${effectiveQrRaw} » correspond déjà à la réf. fabricant de « ${otherLabel} » (${otherRef}).`
            : `QR Code "${effectiveQrRaw}" matches the manufacturer ref of "${otherLabel}" (${otherRef}).`;
      }
    }
  }

  const firstError =
    fieldErrors.reference ||
    fieldErrors.manufacturer_ref ||
    fieldErrors.barcode ||
    fieldErrors.qr_code;

  return {
    valid: !firstError,
    error: firstError,
    fieldErrors,
  };
}


