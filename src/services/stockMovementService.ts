import { SupabaseClient } from '@supabase/supabase-js';
import { Depot, Product, StockLevel, StockMovement, User } from '../types';
import { TABLES } from '../constants/tables';
import {
  isNetworkOrFetchError,
  pushMovementToSupabase,
  STOCK_MOVEMENTS_SQL_OUTDATED_MESSAGE,
} from './clientSupabase';
import {
  deleteFromStore,
  enqueueRejectedSyncOperation,
  enqueueSyncOperation,
  generateOperationId,
  getByIdFromStore,
  putToStore,
} from './offline/indexedDb';

const JWT_REGEX = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const BEARER_REGEX = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const PIN_FIELD_REGEX = /("(?:pin|pin_hash|password|token|access_token|refresh_token)"\s*:\s*")[^"]*(")/gi;
const PIN_KV_REGEX = /\b(pin|pin_hash|password|token|access_token|refresh_token)\s*([=:])\s*[^\s,;)"']+/gi;

/**
 * Redacts JWT tokens, Bearer headers, and PIN/password fields from any string or error object before console logging.
 */
export function sanitizeStringForConsole(input: string): string {
  if (!input) return '';
  return String(input)
    .replace(BEARER_REGEX, 'Bearer [REDACTED]')
    .replace(JWT_REGEX, '[JWT_REDACTED]')
    .replace(PIN_FIELD_REGEX, '$1[REDACTED]$2')
    .replace(PIN_KV_REGEX, '$1$2[REDACTED]');
}

export function sanitizeErrorForConsole(err: unknown): Record<string, unknown> | string {
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') {
    return sanitizeStringForConsole(err);
  }
  if (err instanceof Error) {
    const anyErr = err as any;
    return {
      name: err.name,
      message: sanitizeStringForConsole(err.message),
      ...(anyErr.code ? { code: String(anyErr.code) } : {}),
      ...(anyErr.details ? { details: sanitizeStringForConsole(String(anyErr.details)) } : {}),
      ...(anyErr.hint ? { hint: sanitizeStringForConsole(String(anyErr.hint)) } : {}),
    };
  }
  if (typeof err === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(err as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (
        lower === 'pin' ||
        lower === 'pin_hash' ||
        lower === 'password' ||
        lower === 'token' ||
        lower === 'access_token' ||
        lower === 'refresh_token' ||
        lower === 'authorization'
      ) {
        out[k] = '[REDACTED]';
      } else if (typeof v === 'string') {
        out[k] = sanitizeStringForConsole(v);
      } else if (v && typeof v === 'object') {
        out[k] = sanitizeErrorForConsole(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return sanitizeStringForConsole(String(err));
}

/**
 * Builds the user-visible server rejection message:
 * « Mouvement refusé par le serveur : <message> »
 */
export function formatServerMovementRejectionMessage(
  rawMessage?: string | null,
  errorCode?: string | null
): string {
  const cleanMsg = sanitizeStringForConsole((rawMessage || '').trim());
  const code = (errorCode || '').trim();

  const isMissingRpc =
    code === '42883' ||
    code === 'PGRST202' ||
    /function .*process_stock_movement.* does not exist|could not find the function/i.test(cleanMsg);

  let detail = cleanMsg || 'Erreur serveur lors du mouvement de stock.';
  if (isMissingRpc && !detail.includes('dist/install.sql')) {
    detail = `${detail} (${STOCK_MOVEMENTS_SQL_OUTDATED_MESSAGE})`;
  } else if (code && code !== 'P0001' && !detail.includes(code)) {
    detail = `${detail} [${code}]`;
  }

  if (detail.startsWith('Mouvement refusé par le serveur :')) {
    return detail;
  }
  return `Mouvement refusé par le serveur : ${detail}`;
}

export interface CommitStockMovementRollbacks {
  productId: string;
  previousProductQty: number;
  previousStoreName?: string;
  previousShelfName?: string;
  movementId: string;
  depotName?: string;
  previousDepotQty?: number;
  destDepotName?: string;
  previousDestDepotQty?: number;
}

export interface CommitStockMovementServerApplied {
  productId: string;
  newProductQty: number;
  depotName?: string;
  depotQty?: number;
  destDepotName?: string;
  destDepotQty?: number;
  rackLocation?: string;
  minAlert?: number;
  updatedStoreName?: string;
  updatedShelfName?: string;
  movement: StockMovement;
}

export interface CommitStockMovementCallbacks {
  applyServerState?: (applied: CommitStockMovementServerApplied) => void;
  rollbackLocalState: (rollback: CommitStockMovementRollbacks) => void;
  onErrorMessage?: (visibleMessage: string) => void;
  onSyncQueueChanged?: () => void;
}

export interface CommitStockMovementOptions {
  client: SupabaseClient | null;
  movement: StockMovement;
  optimisticProductQty?: number;
  expectedNewProductQty?: number;
  previousProductQty: number;
  previousStoreName?: string;
  previousShelfName?: string;
  previousDepotQty?: number;
  previousDestDepotQty?: number;
  currentUserId?: string | number | null;
  operationId?: string;
  destDepotName?: string;
  destRack?: string;
  minAlert?: number;
  actionType?: string;
  isOnline?: boolean;
  recordRejectedInQueue?: boolean;
  applyServerProductState?: (
    productId: string,
    serverQty: number,
    depotQty?: number,
    destDepotQty?: number
  ) => void;
  rollbackLocalState?: (
    productId: string,
    restoredQty: number,
    movementId: string,
    restoredStoreName?: string,
    restoredShelfName?: string
  ) => void;
  notifyError?: (visibleMessage: string) => void;
  callbacks?: CommitStockMovementCallbacks;
}

export interface CommitStockMovementResult {
  success: boolean;
  status: 'committed' | 'synced' | 'queued_offline' | 'rejected';
  rolledBack: boolean;
  operationId: string;
  message: string;
  newQty?: number;
  depotQty?: number;
  destDepotQty?: number;
  error?: string;
  errorCode?: string;
}

/**
 * Fonction centrale unique pour exécuter un mouvement de stock (IN, OUT, TRANSFER, INVENTORY)
 * depuis tous les écrans (Mobile et Bureau).
 */
export async function commitStockMovement(
  options: CommitStockMovementOptions
): Promise<CommitStockMovementResult> {
  const {
    client,
    movement,
    optimisticProductQty,
    expectedNewProductQty,
    previousProductQty,
    previousStoreName,
    previousShelfName,
    previousDepotQty,
    previousDestDepotQty,
    currentUserId,
    operationId,
    destDepotName,
    destRack,
    minAlert,
    actionType,
    isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
    recordRejectedInQueue = true,
    applyServerProductState,
    rollbackLocalState,
    notifyError,
    callbacks,
  } = options;

  const targetNewProductQty =
    typeof optimisticProductQty === 'number'
      ? optimisticProductQty
      : typeof expectedNewProductQty === 'number'
      ? expectedNewProductQty
      : previousProductQty;

  const opId = operationId || generateOperationId();
  const effectiveType = String(movement.type || movement.movement_type || 'OUT').toUpperCase();
  const effectiveDepot = movement.depot_name || 'Dépôt Principal';
  const effectiveDestDepot =
    destDepotName ||
    movement.dest_depot_name ||
    (movement.metadata?.dest_depot_name as string) ||
    undefined;
  const effectiveDestRack =
    destRack ||
    movement.dest_rack ||
    (movement.metadata?.dest_rack as string) ||
    (movement.metadata?.rack_location as string) ||
    undefined;

  const rpcPayload = {
    product_id: String(movement.product_id),
    depot_name: effectiveDepot,
    dest_depot_name: effectiveDestDepot || null,
    dest_rack: effectiveDestRack || null,
    type: effectiveType,
    quantity:
      effectiveType === 'INVENTORY'
        ? Number(movement.quantity ?? targetNewProductQty)
        : Number(movement.quantity ?? movement.quantity_changed ?? 0),
    reason:
      movement.reason ||
      (movement.site_number ? `Chantier: ${movement.site_number}` : null),
    project_name: movement.project_name || movement.site_number || null,
    department: movement.department || movement.department_name || null,
    action: actionType || movement.action || 'STOCK_DIRECT_MOVE',
    previous_product_qty: previousProductQty,
    expected_new_product_qty: targetNewProductQty,
    local_movement_id: movement.id,
    previous_store_name: previousStoreName,
    previous_shelf_name: previousShelfName,
    metadata: {
      id: movement.id,
      local_movement_id: movement.id,
      product_ref: movement.product_ref,
      previous_product_qty: previousProductQty,
      ...(previousStoreName !== undefined ? { previous_store_name: previousStoreName } : {}),
      ...(previousShelfName !== undefined ? { previous_shelf_name: previousShelfName } : {}),
      ...(movement.order_number ? { order_number: movement.order_number } : {}),
      ...(effectiveDestDepot ? { dest_depot_name: effectiveDestDepot } : {}),
      ...(effectiveDestRack ? { dest_rack: effectiveDestRack, rack_location: effectiveDestRack } : {}),
      ...(minAlert !== undefined ? { min_alert: minAlert } : {}),
      ...(movement.metadata || {}),
    },
    movement_snapshot: movement,
  };

  // Sauvegarde optimiste dans IndexedDB
  await putToStore('stock_movements', movement).catch(() => {});

  // Cas 1 : Mode hors-ligne ou client non configuré -> file d'attente (pending)
  if (!client || !isOnline) {
    await enqueueSyncOperation(TABLES.movements, 'RPC_STOCK_MOVEMENT', rpcPayload, opId).catch(
      () => {}
    );
    callbacks?.onSyncQueueChanged?.();
    return {
      success: true,
      status: 'queued_offline',
      rolledBack: false,
      operationId: opId,
      message: 'Enregistré hors ligne (en file d’attente).',
      newQty: targetNewProductQty,
    };
  }

  // Cas 2 : En ligne -> Appel de la RPC serveur process_stock_movement
  const res = await pushMovementToSupabase(
    client,
    {
      ...movement,
      depot_name: effectiveDepot,
      metadata: rpcPayload.metadata,
    },
    targetNewProductQty,
    currentUserId ?? undefined,
    opId,
    effectiveDestDepot,
    effectiveDestRack,
    actionType || movement.action || 'STOCK_DIRECT_MOVE'
  );

  // Issue 2a : Succès serveur
  if (res.success) {
    const finalProductQty =
      typeof res.newQty === 'number' ? res.newQty : targetNewProductQty;

    applyServerProductState?.(
      String(movement.product_id),
      finalProductQty,
      res.depotQty,
      res.destDepotQty
    );

    callbacks?.applyServerState?.({
      productId: String(movement.product_id),
      newProductQty: finalProductQty,
      depotName: effectiveDepot,
      depotQty: res.depotQty,
      destDepotName: effectiveDestDepot,
      destDepotQty: res.destDepotQty,
      rackLocation: effectiveDestRack,
      minAlert,
      movement,
    });

    try {
      const existingProd = await getByIdFromStore<Product>(
        'products',
        String(movement.product_id)
      );
      if (existingProd) {
        await putToStore('products', {
          ...existingProd,
          quantity: finalProductQty,
        });
      }
    } catch {}

    return {
      success: true,
      status: 'committed',
      rolledBack: false,
      operationId: opId,
      message: 'Mouvement synchronisé avec succès.',
      newQty: finalProductQty,
      depotQty: res.depotQty,
      destDepotQty: res.destDepotQty,
    };
  }

  // Issue 2b : Erreur réseau -> mise en file d'attente (pending)
  if (res.isNetworkError) {
    await enqueueSyncOperation(TABLES.movements, 'RPC_STOCK_MOVEMENT', rpcPayload, opId).catch(
      () => {}
    );
    callbacks?.onSyncQueueChanged?.();
    return {
      success: true,
      status: 'queued_offline',
      rolledBack: false,
      operationId: opId,
      message: 'Réseau indisponible : mouvement mis en file d’attente.',
      newQty: targetNewProductQty,
    };
  }

  // Issue 2c : Toute autre erreur serveur (42883, 42501, P0001, 23514, validation, licence, dépôt inconnu)
  // 1. Journalisation complète en console (sans jeton ni PIN)
  console.error(
    '[StockMovement] Refus serveur lors de process_stock_movement:',
    sanitizeErrorForConsole({
      operationId: opId,
      productId: movement.product_id,
      productRef: movement.product_ref,
      type: effectiveType,
      depot: effectiveDepot,
      destDepot: effectiveDestDepot,
      errorCode: res.errorCode,
      error: res.rawError || res.error,
    })
  );

  // 2. Annulation de la mise à jour locale (restauration quantité produit + retrait du mouvement)
  rollbackLocalState?.(
    String(movement.product_id),
    previousProductQty,
    movement.id,
    previousStoreName,
    previousShelfName
  );

  callbacks?.rollbackLocalState({
    productId: String(movement.product_id),
    previousProductQty,
    previousStoreName,
    previousShelfName,
    movementId: movement.id,
    depotName: effectiveDepot,
    previousDepotQty,
    destDepotName: effectiveDestDepot,
    previousDestDepotQty,
  });

  await deleteFromStore('stock_movements', movement.id).catch(() => {});
  try {
    const existingProd = await getByIdFromStore<Product>(
      'products',
      String(movement.product_id)
    );
    if (existingProd) {
      await putToStore('products', {
        ...existingProd,
        quantity: previousProductQty,
        ...(previousStoreName !== undefined ? { store_name: previousStoreName } : {}),
        ...(previousShelfName !== undefined ? { shelf_name: previousShelfName } : {}),
      });
    }
  } catch {}

  // 3. Message d'erreur visible et lisible
  const visibleError = formatServerMovementRejectionMessage(res.error, res.errorCode);
  notifyError?.(visibleError);
  callbacks?.onErrorMessage?.(visibleError);

  // 4. Ne PAS mettre en file d'attente pending : marquer comme « rejected » avec le message
  if (recordRejectedInQueue) {
    await enqueueRejectedSyncOperation(
      TABLES.movements,
      'RPC_STOCK_MOVEMENT',
      rpcPayload,
      visibleError,
      opId
    ).catch(() => {});
    callbacks?.onSyncQueueChanged?.();
  }

  return {
    success: false,
    status: 'rejected',
    rolledBack: true,
    operationId: opId,
    message: visibleError,
    error: visibleError,
    errorCode: res.errorCode,
  };
}

/**
 * Met à jour localement le tableau stockLevels après un mouvement réussi ou annulé.
 */
export function applyMovementToStockLevelsList(
  prevLevels: StockLevel[],
  params: {
    productId: string;
    depotName: string;
    newDepotQty?: number;
    newDestDepotQty?: number;
    destRack?: string;
    type?: string;
    quantity?: number;
    depotQty?: number;
    destDepotName?: string;
    destDepotQty?: number;
    rackLocation?: string;
    minAlert?: number;
  }
): StockLevel[] {
  const {
    productId,
    depotName,
    newDepotQty,
    newDestDepotQty,
    destRack,
    type,
    quantity = 0,
    depotQty,
    destDepotName,
    destDepotQty,
    rackLocation,
    minAlert,
  } = params;
  const nowIso = new Date().toISOString();
  const cleanPid = String(productId);
  const cleanDepot = (depotName || 'Dépôt Principal').trim();
  const cleanDest = destDepotName ? destDepotName.trim() : undefined;
  const upperType = String(type || 'OUT').toUpperCase();
  const effectiveRack = rackLocation ?? destRack;
  const effectiveDepotQty = typeof newDepotQty === 'number' ? newDepotQty : depotQty;
  const effectiveDestQty = typeof newDestDepotQty === 'number' ? newDestDepotQty : destDepotQty;

  const next = [...prevLevels];

  const upsertLevel = (
    targetDepot: string,
    computeQty: (curr: number) => number,
    explicitRack?: string,
    explicitMinAlert?: number
  ) => {
    const idx = next.findIndex(
      (l) =>
        String(l.product_id) === cleanPid &&
        l.depot_name.trim().toLowerCase() === targetDepot.toLowerCase()
    );
    if (idx !== -1) {
      const existing = next[idx];
      next[idx] = {
        ...existing,
        quantity: Math.max(0, computeQty(Number(existing.quantity) || 0)),
        rack_location:
          explicitRack !== undefined && explicitRack !== ''
            ? explicitRack
            : existing.rack_location,
        min_alert:
          explicitMinAlert !== undefined ? explicitMinAlert : existing.min_alert,
        updated_at: nowIso,
      };
    } else {
      next.push({
        id: `sl-${cleanPid}-${targetDepot}`,
        product_id: cleanPid,
        depot_name: targetDepot,
        quantity: Math.max(0, computeQty(0)),
        rack_location: explicitRack || undefined,
        min_alert: explicitMinAlert ?? 2,
        updated_at: nowIso,
      });
    }
  };

  if (typeof effectiveDepotQty === 'number') {
    upsertLevel(
      cleanDepot,
      () => effectiveDepotQty,
      !cleanDest ? effectiveRack : undefined,
      minAlert
    );
  } else if (upperType === 'INVENTORY') {
    upsertLevel(cleanDepot, () => quantity, effectiveRack, minAlert);
  } else if (upperType === 'IN' || upperType === 'RETURN') {
    upsertLevel(cleanDepot, (c) => c + quantity, effectiveRack, minAlert);
  } else if (upperType === 'OUT' || upperType === 'LOSS' || upperType === 'TRANSFER') {
    upsertLevel(cleanDepot, (c) => Math.max(0, c - quantity));
  }

  if (cleanDest) {
    if (typeof effectiveDestQty === 'number') {
      upsertLevel(cleanDest, () => effectiveDestQty, effectiveRack, minAlert);
    } else if (upperType === 'TRANSFER') {
      upsertLevel(cleanDest, (c) => c + quantity, effectiveRack, minAlert);
    }
  }

  return next;
}

// =========================================================================
// LOT 2 (v49) : TRANSFERT MULTI-ARTICLES ENTRE DÉPÔTS (transfer_stock_batch)
// =========================================================================

/**
 * Retourne la liste des dépôts actifs (non fermés temporairement) auxquels l'utilisateur a accès.
 */
export function getActiveAllowedDepots(
  user: User | null | undefined,
  depots: Depot[]
): Depot[] {
  if (!user || !Array.isArray(depots)) return [];
  const activeDepots = depots.filter((d) => d && d.is_active !== false && Boolean(d.name));
  const allowedList = user.allowed_depots;
  if (!allowedList || allowedList.length === 0 || allowedList.includes('*')) {
    return activeDepots;
  }
  const normalizedAllowed = new Set(allowedList.map((n) => String(n).trim().toLowerCase()));
  return activeDepots.filter(
    (d) =>
      normalizedAllowed.has(String(d.name).trim().toLowerCase()) ||
      normalizedAllowed.has(String(d.id).trim().toLowerCase())
  );
}

/**
 * Indique si le bouton / écran « Transférer » doit être visible pour l'utilisateur :
 * - L'utilisateur a le rôle 0/1 ou la permission `perm_stock_transfer`
 * - ET il existe au moins 2 dépôts actifs auxquels l'utilisateur a accès.
 */
export function canUserTransferStock(
  user: User | null | undefined,
  depots: Depot[],
  hasTransferPermission?: boolean
): boolean {
  if (!user) return false;
  const roleId = Number(user.role_id);
  const isAuthorized = roleId === 0 || roleId === 1 || Boolean(hasTransferPermission);
  if (!isAuthorized) return false;
  return getActiveAllowedDepots(user, depots).length >= 2;
}

/**
 * Calcule le stock disponible d'un article dans un dépôt donné à partir de `stockLevels`
 * (ou repli sur `product.quantity` uniquement si aucune ligne `stockLevels` n'existe pour cet article).
 */
export function getAvailableStockInDepot(
  productOrId: Product | string | number,
  depotName: string,
  stockLevels: StockLevel[],
  products?: Product[]
): number {
  const cleanPid = String(
    typeof productOrId === 'object' && productOrId !== null ? productOrId.id : productOrId || ''
  ).trim();
  const cleanDepot = String(depotName || '').trim().toLowerCase();
  if (!cleanPid || !cleanDepot) return 0;

  const productLevels = (stockLevels || []).filter(
    (sl) => String(sl.product_id).trim() === cleanPid
  );
  const exactRow = productLevels.find(
    (sl) => String(sl.depot_name || '').trim().toLowerCase() === cleanDepot
  );
  if (exactRow) {
    return Math.max(0, Number(exactRow.quantity) || 0);
  }
  if (productLevels.length > 0) {
    return 0;
  }
  const prod =
    typeof productOrId === 'object' && productOrId !== null
      ? productOrId
      : (products || []).find((p) => String(p.id).trim() === cleanPid);
  if (
    prod &&
    String(prod.store_name || 'Dépôt Principal').trim().toLowerCase() === cleanDepot
  ) {
    return Math.max(0, Number(prod.quantity) || 0);
  }
  return 0;
}

/**
 * Détecte si un mouvement de stock correspond à un transfert inter-dépôts.
 */
export function isTransferMovement(m: StockMovement | null | undefined): boolean {
  if (!m) return false;
  if (String(m.type || '').toUpperCase() === 'TRANSFER') return true;
  if (String(m.action || '').toUpperCase().includes('TRANSFER')) return true;
  if (m.dest_depot_name && String(m.dest_depot_name).trim() !== '') return true;
  const meta = (m.metadata || {}) as Record<string, any>;
  if (meta.dest_depot_name && String(meta.dest_depot_name).trim() !== '') return true;
  if (
    typeof m.site_number === 'string' &&
    m.site_number.trim().toUpperCase().startsWith('TRANSFERT')
  ) {
    return true;
  }
  if (typeof m.id === 'string' && m.id.toUpperCase().startsWith('MOV-TRF-')) {
    return true;
  }
  return false;
}

export function getMovementSourceDepot(
  m: StockMovement,
  fallbackProduct?: Product | null
): string {
  const meta = (m.metadata || {}) as Record<string, any>;
  return (
    m.depot_name ||
    (typeof meta.source_depot === 'string' ? meta.source_depot : '') ||
    fallbackProduct?.store_name ||
    'Dépôt Principal'
  );
}

export function getMovementDestDepot(m: StockMovement): string {
  const meta = (m.metadata || {}) as Record<string, any>;
  if (m.dest_depot_name && String(m.dest_depot_name).trim() !== '') {
    return String(m.dest_depot_name).trim();
  }
  if (meta.dest_depot_name && String(meta.dest_depot_name).trim() !== '') {
    return String(meta.dest_depot_name).trim();
  }
  if (typeof m.site_number === 'string') {
    const match = m.site_number.match(/^TRANSFERT\s*->\s*(.+)$/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return '';
}

export function getMovementBatchId(m: StockMovement): string | null {
  if (m.batch_id && String(m.batch_id).trim() !== '') {
    return String(m.batch_id).trim();
  }
  const meta = (m.metadata || {}) as Record<string, any>;
  if (meta.batch_id && String(meta.batch_id).trim() !== '') {
    return String(meta.batch_id).trim();
  }
  return null;
}

export interface TransferBatchDisplayGroup {
  isBatchGroup: boolean;
  groupKey: string;
  key: string;
  batchId: string | null;
  sourceDepot: string;
  destDepot: string;
  created_at: string;
  user_name?: string;
  reason?: string | null;
  movements: StockMovement[];
  items: StockMovement[];
  totalQuantity: number;
}

/**
 * Regroupe les mouvements de transfert qui partagent le même `batch_id`
 * (ou même utilisateur, mêmes dépôts source/destination et même minute).
 */
export function groupMovementsByTransferBatch(
  movements: StockMovement[]
): TransferBatchDisplayGroup[] {
  const groups: TransferBatchDisplayGroup[] = [];
  const indexByTransferKey = new Map<string, number>();

  for (const m of movements) {
    if (!isTransferMovement(m)) {
      const list = [m];
      groups.push({
        isBatchGroup: false,
        groupKey: m.id,
        key: m.id,
        batchId: null,
        sourceDepot: getMovementSourceDepot(m),
        destDepot: '',
        created_at: m.created_at,
        user_name: m.user_name,
        reason: m.reason,
        movements: list,
        items: list,
        totalQuantity: Math.abs(Number(m.quantity ?? m.quantity_changed ?? 0)),
      });
      continue;
    }

    const src = getMovementSourceDepot(m);
    const dst = getMovementDestDepot(m) || '—';
    const explicitBatchId = getMovementBatchId(m);
    const minuteBucket = String(m.created_at || '').slice(0, 16);
    const key = explicitBatchId
      ? `batch:${explicitBatchId}`
      : `implicit:${m.user_name || ''}:${src.toLowerCase()}->${dst.toLowerCase()}:${minuteBucket}`;

    const qty = Math.abs(Number(m.quantity ?? m.quantity_changed ?? 0));
    const existingIdx = indexByTransferKey.get(key);
    if (existingIdx !== undefined) {
      const grp = groups[existingIdx];
      grp.movements.push(m);
      grp.totalQuantity += qty;
      grp.isBatchGroup = grp.movements.length > 1 || Boolean(explicitBatchId);
      if (!grp.reason && m.reason) {
        grp.reason = m.reason;
      }
    } else {
      const idx = groups.length;
      indexByTransferKey.set(key, idx);
      const list = [m];
      groups.push({
        isBatchGroup: Boolean(explicitBatchId),
        groupKey: key,
        key,
        batchId: explicitBatchId,
        sourceDepot: src,
        destDepot: dst,
        created_at: m.created_at,
        user_name: m.user_name,
        reason: m.reason,
        movements: list,
        items: list,
        totalQuantity: qty,
      });
    }
  }

  return groups;
}

export interface TransferBatchItemInput {
  productId: string;
  quantity: number;
  destRack?: string;
}

export interface TransferBatchRollbackSnapshot {
  productId: string;
  previousSourceQty: number;
  previousDestQty: number;
  previousDestRack?: string;
  localMovementId: string;
}

export interface CommitStockTransferBatchOptions {
  client?: SupabaseClient | null;
  batchId?: string;
  sourceDepot: string;
  destDepot: string;
  items: TransferBatchItemInput[];
  reason?: string;
  localMovements?: StockMovement[];
  rollbackSnapshots?: TransferBatchRollbackSnapshot[];
  isOnline?: boolean;
  recordRejectedInQueue?: boolean;
  applyServerState?: (serverData: any) => void;
  rollbackLocalState?: () => void;
  onErrorMessage?: (visibleMessage: string) => void;
  onSyncQueueChanged?: () => void;
}

export interface CommitStockTransferBatchResult {
  success: boolean;
  status: 'committed' | 'queued_offline' | 'rejected';
  rolledBack: boolean;
  batchId: string;
  message: string;
  error?: string;
  errorCode?: string;
  serverData?: any;
}

/**
 * Exécute un lot de transfert multi-articles atomique via la RPC `transfer_stock_batch`.
 * - En ligne : appel RPC `transfer_stock_batch`, rollback complet si échec serveur.
 * - Hors-ligne / erreur réseau : enfile `RPC_STOCK_TRANSFER_BATCH` avec `batchId` pour rejeu idempotent.
 */
export async function commitStockTransferBatch(
  options: CommitStockTransferBatchOptions
): Promise<CommitStockTransferBatchResult> {
  const {
    client = null,
    batchId: explicitBatchId,
    sourceDepot,
    destDepot,
    items,
    reason,
    localMovements = [],
    rollbackSnapshots = [],
    isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
    recordRejectedInQueue = true,
    applyServerState,
    rollbackLocalState = () => {},
    onErrorMessage,
    onSyncQueueChanged,
  } = options;

  const batchId = explicitBatchId || generateOperationId();
  const cleanSource = String(sourceDepot || '').trim();
  const cleanDest = String(destDepot || '').trim();
  const cleanReason = reason && reason.trim() ? reason.trim() : null;

  if (!cleanSource || !cleanDest) {
    throw new Error('Les dépôts source et destination sont obligatoires.');
  }
  if (cleanSource.toLowerCase() === cleanDest.toLowerCase()) {
    throw new Error('Le dépôt source et le dépôt destination doivent être différents.');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Le lot de transfert doit contenir au moins un article.');
  }
  for (const item of items) {
    if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) {
      throw new Error('La quantité à transférer doit être strictement supérieure à 0.');
    }
  }

  const rpcItems = items.map((item) => ({
    product_id: String(item.productId),
    quantity: Math.max(0, Math.floor(Number(item.quantity) || 0)),
    ...(item.destRack && item.destRack.trim() ? { dest_rack: item.destRack.trim() } : {}),
  }));

  const queuePayload = {
    batch_id: batchId,
    p_batch_id: batchId,
    p_source_depot: cleanSource,
    p_dest_depot: cleanDest,
    p_items: rpcItems,
    p_reason: cleanReason,
    local_movement_ids: localMovements.map((m) => m.id),
    rollback_snapshots: rollbackSnapshots,
  };

  // Sauvegarde optimiste des mouvements locaux dans IndexedDB
  for (const mov of localMovements) {
    await putToStore('stock_movements', mov).catch(() => {});
  }

  // Cas 1 : Mode hors-ligne ou pas de client -> mise en file d'attente IndexedDB
  if (!client || !isOnline) {
    await enqueueSyncOperation(
      TABLES.movements,
      'RPC_STOCK_TRANSFER_BATCH',
      queuePayload,
      batchId
    ).catch(() => {});
    onSyncQueueChanged?.();
    return {
      success: true,
      status: 'queued_offline',
      rolledBack: false,
      batchId,
      message: 'Transfert en attente de synchronisation',
    };
  }

  // Cas 2 : En ligne -> Appel de la RPC send_stock_transfer
  try {
    const { data, error } = await client.rpc('send_stock_transfer', {
      p_batch_id: batchId,
      p_source_depot: cleanSource,
      p_dest_depot: cleanDest,
      p_items: rpcItems,
      p_reason: cleanReason,
    });

    if (!error && (!data || data.success !== false)) {
      applyServerState?.(data);
      return {
        success: true,
        status: 'committed',
        rolledBack: false,
        batchId,
        message: 'Transfert envoyé — en attente de validation.',
        serverData: data,
      };
    }

    if (error && isNetworkOrFetchError(error)) {
      await enqueueSyncOperation(
        TABLES.movements,
        'RPC_STOCK_TRANSFER_BATCH',
        queuePayload,
        batchId
      ).catch(() => {});
      onSyncQueueChanged?.();
      return {
        success: true,
        status: 'queued_offline',
        rolledBack: false,
        batchId,
        message: 'Transfert en attente de synchronisation',
      };
    }

    const rawMsg = error?.message || data?.message || 'Erreur serveur lors du transfert.';
    const errCode = (error as any)?.code ? String((error as any).code) : undefined;

    console.error(
      '[StockTransferBatch] Refus serveur lors de send_stock_transfer:',
      sanitizeErrorForConsole({
        batchId,
        sourceDepot: cleanSource,
        destDepot: cleanDest,
        itemsCount: rpcItems.length,
        errorCode: errCode,
        error: error || data,
      })
    );

    // Annulation complète de la mise à jour optimiste
    rollbackLocalState();
    for (const mov of localMovements) {
      await deleteFromStore('stock_movements', mov.id).catch(() => {});
    }

    const visibleError = sanitizeStringForConsole(String(rawMsg).trim()) || formatServerMovementRejectionMessage(rawMsg, errCode);
    onErrorMessage?.(visibleError);

    if (recordRejectedInQueue) {
      await enqueueRejectedSyncOperation(
        TABLES.movements,
        'RPC_STOCK_TRANSFER_BATCH',
        queuePayload,
        visibleError,
        batchId
      ).catch(() => {});
      onSyncQueueChanged?.();
    }

    return {
      success: false,
      status: 'rejected',
      rolledBack: true,
      batchId,
      message: visibleError,
      error: visibleError,
      errorCode: errCode,
    };
  } catch (err: any) {
    if (isNetworkOrFetchError(err)) {
      await enqueueSyncOperation(
        TABLES.movements,
        'RPC_STOCK_TRANSFER_BATCH',
        queuePayload,
        batchId
      ).catch(() => {});
      onSyncQueueChanged?.();
      return {
        success: true,
        status: 'queued_offline',
        rolledBack: false,
        batchId,
        message: 'Transfert en attente de synchronisation',
      };
    }

    rollbackLocalState();
    for (const mov of localMovements) {
      await deleteFromStore('stock_movements', mov.id).catch(() => {});
    }
    const visibleError = sanitizeStringForConsole(String(err?.message || err).trim()) || formatServerMovementRejectionMessage(err?.message || String(err));
    onErrorMessage?.(visibleError);

    if (recordRejectedInQueue) {
      await enqueueRejectedSyncOperation(
        TABLES.movements,
        'RPC_STOCK_TRANSFER_BATCH',
        queuePayload,
        visibleError,
        batchId
      ).catch(() => {});
      onSyncQueueChanged?.();
    }

    return {
      success: false,
      status: 'rejected',
      rolledBack: true,
      batchId,
      message: visibleError,
      error: visibleError,
    };
  }
}

