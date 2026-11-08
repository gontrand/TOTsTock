import { Depot, MaterialOrder, MaterialOrderItem, Product, Role, User } from '../types';
import { playScanBeep } from '../utils/crypto';
import { getUnlockedAudioContext, hapticFeedback } from '../utils/haptics';
import { isUserAuthorizedPreparerForOrder } from './notificationService';
import {
  readLocalPreferenceValue,
  setUserPreference,
} from './userPreferencesService';

export const SCANNER_SOUND_KEY = 'tot_scanner_sound_enabled';
export const SCANNER_VIBRATION_KEY = 'tot_scanner_vibration_enabled';
export const SCANNER_DUPLICATE_COOLDOWN_MS = 1500;

export type PickingSortStrategy = 'rack_location' | 'default';

export interface GetNextItemOptions {
  strategy?: PickingSortStrategy;
  products?: Product[];
  skippedProductIds?: (string | number)[];
}

export interface OrderPickingProgress {
  processedLines: number;
  totalLines: number;
  pickedLines: number;
  unavailableLines: number;
  partialLines: number;
  substitutedLines: number;
  remainingLines: number;
  pickedQuantity: number;
  requestedQuantity: number;
  percent: number;
}

export interface ScannedOrderMatchResult {
  kind:
    | 'expected_item'
    | 'other_order_item'
    | 'already_picked_item'
    | 'catalog_substitute_candidate'
    | 'unknown_code';
  normalizedCode: string;
  matchedItem?: MaterialOrderItem;
  catalogProduct?: Product;
}

/**
 * Normalise un code scanné ou saisi en supprimant les espaces superflus,
 * les préfixes QR internes éventuels (TOT-PROD:, TOT-REF:) et en passant en minuscules.
 */
export function normalizeScanCode(rawCode: string | null | undefined): string {
  if (!rawCode) return '';
  let cleaned = String(rawCode).trim();

  // Si c'est un JSON de QR d'étiquette article, extraire reference / barcode / id
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object') {
        const extracted =
          parsed.reference ||
          parsed.product_ref ||
          parsed.barcode ||
          parsed.qr_code ||
          parsed.id;
        if (extracted) {
          cleaned = String(extracted).trim();
        }
      }
    } catch {
      // Ignorer si JSON invalide
    }
  }

  // Supprimer les préfixes QR standards d'articles (mais conserver TOT-ORDER: intact pour parseOrderQrCodePayload)
  cleaned = cleaned.replace(/^tot[-_](?:prod|ref|item|qr):/i, '').trim();

  // Normaliser sans espaces internes ni casse pour la comparaison souple
  return cleaned.replace(/\s+/g, '').toLowerCase();
}

/**
 * Extrait le numéro ou l'identifiant d'une commande depuis un QR code de commande (`TOT-ORDER:<numéro>` ou JSON).
 */
export function parseOrderQrCodePayload(rawCode: string | null | undefined): string | null {
  if (!rawCode) return null;
  const trimmed = String(rawCode).trim();
  if (!trimmed) return null;

  const prefixMatch = trimmed.match(/^TOT-ORDER:(.+)$/i);
  if (prefixMatch && prefixMatch[1]) {
    return prefixMatch[1].trim();
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed &&
        (parsed.type === 'TOT_ORDER_PICKUP' || parsed.order_number || parsed.order_id)
      ) {
        return String(parsed.order_number || parsed.order_id).trim();
      }
    } catch {
      // Pas un JSON valide
    }
  }

  return null;
}

/**
 * Récupère l'emplacement de picking (`rack_location`) d'une ligne de commande,
 * avec repli sur la fiche produit (`rack_location`, `shelf_name`, `room_name`).
 */
export function getItemRackLocation(
  item: MaterialOrderItem,
  products: Product[] = []
): string {
  if (item.rack_location && String(item.rack_location).trim()) {
    return String(item.rack_location).trim();
  }

  const targetId =
    item.substituted && item.substituted_with_id
      ? item.substituted_with_id
      : item.product_id;
  const targetRef =
    item.substituted && item.substituted_with_ref
      ? item.substituted_with_ref
      : item.product_ref;

  const prod = products.find(
    (p) =>
      String(p.id) === String(targetId) ||
      (targetRef && normalizeScanCode(p.reference) === normalizeScanCode(targetRef))
  );

  if (!prod) return '';
  if (prod.rack_location && String(prod.rack_location).trim()) {
    return String(prod.rack_location).trim();
  }
  const parts = [prod.room_name?.trim(), prod.shelf_name?.trim()].filter(Boolean);
  return parts.join(' - ');
}

/**
 * Comparateur de tri naturel pour les emplacements (`rack_location`) :
 * - "A2" avant "A10"
 * - Les emplacements vides sont toujours placés à la fin.
 */
export function compareRackLocationsNatural(
  locA?: string | null,
  locB?: string | null
): number {
  const cleanA = (locA || '').trim();
  const cleanB = (locB || '').trim();

  if (!cleanA && !cleanB) return 0;
  if (!cleanA) return 1; // Sans emplacement à la fin
  if (!cleanB) return -1;

  return cleanA.localeCompare(cleanB, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

/**
 * Recherche un produit dans le catalogue par référence, code-barres, QR code, ID ou réf fabricant,
 * sans tenir compte de la casse ni des espaces.
 */
export function findCatalogProductByCode(
  code: string,
  products: Product[] = []
): Product | undefined {
  const norm = normalizeScanCode(code);
  if (!norm) return undefined;

  return products.find((p) => {
    if (normalizeScanCode(p.reference) === norm) return true;
    if (normalizeScanCode(String(p.id)) === norm) return true;
    if (p.barcode && normalizeScanCode(p.barcode) === norm) return true;
    if (p.qr_code && normalizeScanCode(p.qr_code) === norm) return true;
    if (p.manufacturer_ref && normalizeScanCode(p.manufacturer_ref) === norm) return true;
    return false;
  });
}

/**
 * Vérifie si une ligne de commande donnée correspond au code scanné.
 */
export function doesOrderItemMatchCode(
  item: MaterialOrderItem,
  code: string,
  products: Product[] = []
): boolean {
  const norm = normalizeScanCode(code);
  if (!norm) return false;

  if (normalizeScanCode(item.product_ref) === norm) return true;
  if (normalizeScanCode(String(item.product_id)) === norm) return true;
  if (item.substituted_with_ref && normalizeScanCode(item.substituted_with_ref) === norm) {
    return true;
  }
  if (
    item.substituted_with_id !== undefined &&
    normalizeScanCode(String(item.substituted_with_id)) === norm
  ) {
    return true;
  }

  // Vérification via le produit catalogue lié (ou le produit de remplacement)
  const catalogProd = findCatalogProductByCode(code, products);
  if (catalogProd) {
    if (String(item.product_id) === String(catalogProd.id)) return true;
    if (normalizeScanCode(item.product_ref) === normalizeScanCode(catalogProd.reference)) {
      return true;
    }
    if (
      item.substituted &&
      item.substituted_with_id !== undefined &&
      String(item.substituted_with_id) === String(catalogProd.id)
    ) {
      return true;
    }
    if (
      item.substituted &&
      item.substituted_with_ref &&
      normalizeScanCode(item.substituted_with_ref) === normalizeScanCode(catalogProd.reference)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Retrouve la ligne d'une commande par référence, code-barres, QR, ou référence du produit de remplacement,
 * sans tenir compte de la casse ni des espaces.
 * Privilégie une ligne non encore pointée si le même article apparaît plusieurs fois.
 */
export function findOrderItemByCode(
  order: Pick<MaterialOrder, 'items'> | null | undefined,
  code: string,
  products: Product[] = []
): MaterialOrderItem | undefined {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    return undefined;
  }
  const norm = normalizeScanCode(code);
  if (!norm) return undefined;

  const matchingItems = order.items.filter((it) => doesOrderItemMatchCode(it, code, products));
  if (matchingItems.length === 0) return undefined;

  // Si plusieurs lignes correspondent, retourner d'abord celle qui n'est ni pointée ni indisponible
  const unpicked = matchingItems.find((it) => !it.picked && !it.unavailable);
  return unpicked || matchingItems[0];
}

/**
 * Analyse un code scanné par rapport à la commande et à la ligne attendue en cours.
 */
export function matchScannedCodeInOrder(
  order: Pick<MaterialOrder, 'items'>,
  code: string,
  products: Product[] = [],
  expectedItem?: MaterialOrderItem | null
): ScannedOrderMatchResult {
  const normalizedCode = normalizeScanCode(code);
  if (!normalizedCode) {
    return { kind: 'unknown_code', normalizedCode: '' };
  }

  const catalogProduct = findCatalogProductByCode(code, products);

  // 1. Vérifier d'abord si le code correspond à la ligne actuellement affichée
  if (expectedItem && doesOrderItemMatchCode(expectedItem, code, products)) {
    const linkedProd =
      catalogProduct ||
      products.find((p) => String(p.id) === String(expectedItem.product_id));
    if (expectedItem.picked) {
      return {
        kind: 'already_picked_item',
        normalizedCode,
        matchedItem: expectedItem,
        catalogProduct: linkedProd,
      };
    }
    return {
      kind: 'expected_item',
      normalizedCode,
      matchedItem: expectedItem,
      catalogProduct: linkedProd,
    };
  }

  // 2. Sinon, vérifier s'il correspond à une autre ligne de la commande
  const matchedOrderItem = findOrderItemByCode(order, code, products);
  if (matchedOrderItem) {
    const linkedProd =
      catalogProduct ||
      products.find((p) => String(p.id) === String(matchedOrderItem.product_id));
    if (matchedOrderItem.picked) {
      return {
        kind: 'already_picked_item',
        normalizedCode,
        matchedItem: matchedOrderItem,
        catalogProduct: linkedProd,
      };
    }
    return {
      kind: 'other_order_item',
      normalizedCode,
      matchedItem: matchedOrderItem,
      catalogProduct: linkedProd,
    };
  }

  // 3. Sinon, vérifier si c'est un article connu du catalogue (candidat au remplacement)
  if (catalogProduct) {
    return {
      kind: 'catalog_substitute_candidate',
      normalizedCode,
      catalogProduct,
    };
  }

  return {
    kind: 'unknown_code',
    normalizedCode,
  };
}

/**
 * Trie les lignes d'une commande selon la stratégie choisie :
 * Par défaut ('rack_location') : `rack_location` croissant (tri naturel : A2 avant A10),
 * les lignes sans emplacement à la fin, puis par désignation (`product_name`).
 */
export function getSortedOrderItemsForPicking(
  order: Pick<MaterialOrder, 'items'> | null | undefined,
  options?: PickingSortStrategy | GetNextItemOptions
): MaterialOrderItem[] {
  if (!order || !Array.isArray(order.items)) return [];

  const opts: GetNextItemOptions =
    typeof options === 'string' ? { strategy: options } : options || {};
  const strategy = opts.strategy || 'rack_location';
  const products = opts.products || [];
  const skippedSet = new Set((opts.skippedProductIds || []).map((id) => String(id)));

  const itemsCopy = [...order.items];

  itemsCopy.sort((a, b) => {
    const aDone = Boolean(a.picked || a.unavailable);
    const bDone = Boolean(b.picked || b.unavailable);
    if (aDone !== bDone) {
      return aDone ? 1 : -1;
    }

    const aSkipped = skippedSet.has(String(a.product_id));
    const bSkipped = skippedSet.has(String(b.product_id));
    if (aSkipped !== bSkipped) {
      return aSkipped ? 1 : -1;
    }

    if (strategy === 'rack_location') {
      const locA = getItemRackLocation(a, products);
      const locB = getItemRackLocation(b, products);
      const cmpLoc = compareRackLocationsNatural(locA, locB);
      if (cmpLoc !== 0) return cmpLoc;
    }

    const nameA = (a.product_name || a.product_ref || '').trim();
    const nameB = (b.product_name || b.product_ref || '').trim();
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  });

  return itemsCopy;
}

/**
 * Retourne la prochaine ligne non traitée (ni `picked`, ni `unavailable`)
 * selon l'ordre par `rack_location` croissant (tri naturel : A2 avant A10) puis par désignation,
 * les lignes sans emplacement à la fin (et les lignes passées tout à la fin).
 */
export function getNextItemToPick(
  order: Pick<MaterialOrder, 'items'> | null | undefined,
  strategy?: PickingSortStrategy | GetNextItemOptions
): MaterialOrderItem | null {
  const sorted = getSortedOrderItemsForPicking(order, strategy);
  const next = sorted.find((it) => !it.picked && !it.unavailable);
  return next || null;
}

/**
 * Retourne `true` si chaque ligne de la commande est prise (`picked === true` avec quantité > 0)
 * ou marquée indisponible (`unavailable === true`).
 */
export function canFinishOrder(
  order: Pick<MaterialOrder, 'items'> | null | undefined
): boolean {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    return false;
  }
  return order.items.every((it) => {
    if (it.unavailable) return true;
    if (!it.picked) return false;
    if (it.picked_quantity !== undefined && it.picked_quantity <= 0) return false;
    return true;
  });
}

/**
 * Calcule la progression complète d'une commande :
 * lignes traitées / total, quantités prises / demandées, lignes partielles, manquantes et remplacées.
 */
export function getOrderProgress(
  order: Pick<MaterialOrder, 'items'> | null | undefined
): OrderPickingProgress {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    return {
      processedLines: 0,
      totalLines: 0,
      pickedLines: 0,
      unavailableLines: 0,
      partialLines: 0,
      substitutedLines: 0,
      remainingLines: 0,
      pickedQuantity: 0,
      requestedQuantity: 0,
      percent: 0,
    };
  }

  let processedLines = 0;
  let pickedLines = 0;
  let unavailableLines = 0;
  let partialLines = 0;
  let substitutedLines = 0;
  let pickedQuantity = 0;
  let requestedQuantity = 0;

  for (const it of order.items) {
    const reqQty = Math.max(0, Number(it.quantity) || 0);
    requestedQuantity += reqQty;

    const isUnavailable = Boolean(it.unavailable);
    const isPicked = Boolean(it.picked) && !isUnavailable;

    if (isPicked || isUnavailable) {
      processedLines++;
    }
    if (isPicked) {
      pickedLines++;
      const pQty =
        it.picked_quantity !== undefined
          ? Math.max(0, Number(it.picked_quantity) || 0)
          : reqQty;
      pickedQuantity += pQty;
      if (pQty > 0 && pQty < reqQty) {
        partialLines++;
      }
    }
    if (isUnavailable) {
      unavailableLines++;
    }
    if (it.substituted) {
      substitutedLines++;
    }
  }

  const totalLines = order.items.length;
  const remainingLines = Math.max(0, totalLines - processedLines);
  const percent = totalLines > 0 ? Math.round((processedLines / totalLines) * 100) : 0;

  return {
    processedLines,
    totalLines,
    pickedLines,
    unavailableLines,
    partialLines,
    substitutedLines,
    remainingLines,
    pickedQuantity,
    requestedQuantity,
    percent,
  };
}

/**
 * Retourne `true` si la commande est assignée à un autre préparateur et que l'utilisateur courant
 * n'est pas administrateur (rôles 0/1) ni détenteur de `perm_orders_manage`.
 */
export function isOrderLockedForUser(
  order: Pick<MaterialOrder, 'preparer_id'> | null | undefined,
  currentUser: Pick<User, 'id' | 'role_id'> | null | undefined,
  hasManagePerm = false
): boolean {
  if (!order) return false;
  if (order.preparer_id === null || order.preparer_id === undefined || order.preparer_id === '') {
    return false;
  }
  if (!currentUser) return true;

  const isSuperOrAdmin =
    Number(currentUser.id) === 0 ||
    Number(currentUser.role_id) === 0 ||
    Number(currentUser.role_id) === 1 ||
    hasManagePerm;

  if (isSuperOrAdmin) return false;
  return String(order.preparer_id) !== String(currentUser.id);
}

/**
 * Vérifie si l'utilisateur courant est autorisé à utiliser le Mode Scanner :
 * `isPreparer` vrai (ou rôles 0 / 1) ET permission `perm_menu_order_prep`.
 */
export function canUserAccessScannerMode(
  currentUser: Pick<User, 'id' | 'role_id' | 'is_preparer'> | null | undefined,
  isPreparer: boolean,
  hasOrderPrepPerm: boolean
): boolean {
  if (!currentUser) return false;
  const isRole0Or1 =
    Number(currentUser.id) === 0 ||
    Number(currentUser.role_id) === 0 ||
    Number(currentUser.role_id) === 1;
  if (isRole0Or1) return true;
  return Boolean((isPreparer || currentUser.is_preparer) && hasOrderPrepPerm);
}

/**
 * Filtre et trie les commandes à préparer pour le Mode Scanner / Préparation :
 * - Statuts `PENDING` ou `PREPARING` uniquement
 * - Filtrage strict par `isUserAuthorizedPreparerForOrder` (union `allowed_depots` ∪ `depotHolders`,
 *   vide = aucun pour un non-admin, tout en conservant celles où `preparer_id == currentUser.id`).
 * - Tri : En cours par moi d'abord, puis À préparer, puis Prise par un autre, et par date de création croissante (les plus anciennes d'abord).
 */
export function filterOrdersForPreparer(
  orders: MaterialOrder[],
  currentUser: User | null | undefined,
  optionsOrDepots?:
    | {
        depotFilter?: string;
        searchQuery?: string;
        depots?: Depot[];
        depotHolders?: Array<{ depot_id: string | number; user_id: string | number }>;
        roles?: Role[];
      }
    | Depot[],
  depotHoldersArg?: Array<{ depot_id: string | number; user_id: string | number }>,
  rolesArg?: Role[]
): MaterialOrder[] {
  if (!currentUser || !Array.isArray(orders)) return [];

  const isArrayArg = Array.isArray(optionsOrDepots);
  const options = isArrayArg ? undefined : optionsOrDepots;
  const depotFilter = (options?.depotFilter || 'ALL').trim();
  const q = (options?.searchQuery || '').trim().toLowerCase();
  const depots = isArrayArg ? optionsOrDepots : options?.depots || [];
  const depotHolders = isArrayArg ? depotHoldersArg || [] : options?.depotHolders || [];
  const roles = isArrayArg ? rolesArg || [] : options?.roles || [];

  const preparerCandidate: User = {
    ...currentUser,
    is_preparer: currentUser.is_preparer ?? true,
  };

  const filtered = orders.filter((order) => {
    if (order.status !== 'PENDING' && order.status !== 'PREPARING') {
      return false;
    }

    const isAuthorized = isUserAuthorizedPreparerForOrder({
      user: preparerCandidate,
      order,
      depots,
      depotHolders,
      roles,
    });
    if (!isAuthorized) {
      return false;
    }

    if (depotFilter && depotFilter !== 'ALL') {
      if ((order.depot_name || '').trim().toLowerCase() !== depotFilter.toLowerCase()) {
        return false;
      }
    }

    if (q) {
      const hay = [
        order.order_number,
        order.site_number,
        order.site_name,
        order.requester_name,
        order.depot_name,
        order.preparer_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });

  return filtered.sort((a, b) => {
    const aMine =
      a.preparer_id !== null &&
      a.preparer_id !== undefined &&
      String(a.preparer_id) === String(currentUser.id);
    const bMine =
      b.preparer_id !== null &&
      b.preparer_id !== undefined &&
      String(b.preparer_id) === String(currentUser.id);

    if (aMine !== bMine) return aMine ? -1 : 1;

    const aUnassigned = !a.preparer_id;
    const bUnassigned = !b.preparer_id;
    if (aUnassigned !== bUnassigned) return aUnassigned ? -1 : 1;

    const timeA = new Date(a.created_at || 0).getTime();
    const timeB = new Date(b.created_at || 0).getTime();
    return timeA - timeB;
  });
}

// -----------------------------------------------------------------------------
// Préférences par appareil pour le Mode Scanner (Son & Vibration dans localStorage)
// -----------------------------------------------------------------------------

export function isScannerSoundEnabled(
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null
): boolean {
  if (!storage) return true;
  try {
    if (typeof localStorage !== 'undefined' && storage === localStorage) {
      const val = readLocalPreferenceValue('scanner_sound');
      if (val !== undefined) return val;
    }
    return storage.getItem(SCANNER_SOUND_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setScannerSoundEnabled(
  enabled: boolean,
  storage: Pick<Storage, 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null
): void {
  if (!storage) return;
  try {
    if (typeof localStorage !== 'undefined' && storage === localStorage) {
      setUserPreference('scanner_sound', Boolean(enabled));
    } else {
      storage.setItem(SCANNER_SOUND_KEY, enabled ? 'true' : 'false');
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tot-scanner-prefs-changed'));
    }
  } catch {
    // Ignore
  }
}

export function isScannerVibrationEnabled(
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null
): boolean {
  if (!storage) return true;
  try {
    if (typeof localStorage !== 'undefined' && storage === localStorage) {
      const val = readLocalPreferenceValue('scanner_vibration');
      if (val !== undefined) return val;
    }
    return storage.getItem(SCANNER_VIBRATION_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setScannerVibrationEnabled(
  enabled: boolean,
  storage: Pick<Storage, 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null
): void {
  if (!storage) return;
  try {
    if (typeof localStorage !== 'undefined' && storage === localStorage) {
      setUserPreference('scanner_vibration', Boolean(enabled));
    } else {
      storage.setItem(SCANNER_VIBRATION_KEY, enabled ? 'true' : 'false');
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tot-scanner-prefs-changed'));
    }
  } catch {
    // Ignore
  }
}

/**
 * Émet le retour sonore et haptique calibré pour le Mode Scanner :
 * - Succès (bon article) : bip aigu court + vibration courte
 * - Erreur (mauvais article) : double bip grave + vibration longue
 */
export function triggerScannerFeedback(kind: 'success' | 'error'): void {
  const soundOn = isScannerSoundEnabled();
  const vibrationOn = isScannerVibrationEnabled();

  if (vibrationOn) {
    try {
      if (kind === 'success') {
        hapticFeedback.scanSuccess();
      } else {
        hapticFeedback.scanError();
      }
    } catch {
      // Ignore
    }
  }

  if (!soundOn) return;

  try {
    const ctx = getUnlockedAudioContext();
    if (!ctx) {
      playScanBeep(kind === 'success');
      return;
    }

    if (kind === 'success') {
      // Bip court aigu
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1046.5, ctx.currentTime); // C6
      osc.frequency.exponentialRampToValueAtTime(1567.98, ctx.currentTime + 0.09); // G6
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.008, ctx.currentTime + 0.11);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.11);
    } else {
      // Double bip grave
      [0, 0.16].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(195, ctx.currentTime + offset);
        osc.frequency.setValueAtTime(155, ctx.currentTime + offset + 0.06);
        gain.gain.setValueAtTime(0.32, ctx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + offset + 0.13);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.135);
      });
    }
  } catch {
    // Fallback
  }
}
