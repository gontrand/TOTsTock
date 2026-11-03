import { MaterialOrder, Product } from '../types';
import { getSyncMetadata, setSyncMetadata } from './offline/indexedDb';
import { isNetworkOrFetchError } from './clientSupabase';

export const SCANNER_QUEUE_META_KEY = 'scanner_offline_queue_v1';
export const SCANNER_QUEUE_STORAGE_KEY = 'tot_scanner_offline_queue_v1';

export type ScannerOfflineActionType =
  | 'PICK_ITEM'
  | 'MARK_UNAVAILABLE'
  | 'SUBSTITUTE_ITEM'
  | 'UNPICK_ITEM';

export type ScannerConflictReason =
  | 'ORDER_CANCELLED'
  | 'TAKEN_BY_OTHER'
  | 'ALREADY_COMPLETED';

export interface ScannerOfflineActionPayload {
  product_id: string | number;
  product_ref?: string;
  picked_quantity?: number;
  scanned_barcode?: string;
  unavailable?: boolean;
  unavailable_comment?: string;
  substitute_product?: Pick<Product, 'id' | 'reference' | 'brand' | 'model'>;
  substitute_reason?: string;
}

export interface ScannerOfflineAction {
  id: string;
  order_id: string;
  order_number?: string;
  user_id: string;
  action_type: ScannerOfflineActionType;
  payload: ScannerOfflineActionPayload;
  created_at: string;
  status: 'pending' | 'syncing' | 'synced' | 'conflict';
  conflict_reason?: ScannerConflictReason;
  conflict_message?: string;
}

export interface ScannerOrderConflict {
  order_id: string;
  order_number: string;
  reason: ScannerConflictReason;
  message: string;
  actionsCount: number;
  remotePreparerName?: string | null;
  remoteStatus?: string;
}

export interface ReplayScannerQueueResult {
  processed: number;
  synced: number;
  remainingPending: number;
  networkInterrupted: boolean;
  conflicts: ScannerOrderConflict[];
}

let memoryQueueFallback: ScannerOfflineAction[] = [];

function notifyScannerQueueChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tot-scanner-queue-changed'));
  }
}

function generateScannerActionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `scan-op-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Nettoie la charge utile pour garantir qu'aucun code PIN, hash de PIN ou jeton d'authentification
 * n'est jamais enregistré dans la file d'attente locale.
 */
function sanitizePayload(payload: ScannerOfflineActionPayload): ScannerOfflineActionPayload {
  const cleanSub = payload.substitute_product
    ? {
        id: String(payload.substitute_product.id),
        reference: String(payload.substitute_product.reference || ''),
        brand: String(payload.substitute_product.brand || ''),
        model: String(payload.substitute_product.model || ''),
      }
    : undefined;

  return {
    product_id: payload.product_id,
    ...(payload.product_ref !== undefined ? { product_ref: payload.product_ref } : {}),
    ...(payload.picked_quantity !== undefined ? { picked_quantity: Number(payload.picked_quantity) } : {}),
    ...(payload.scanned_barcode !== undefined ? { scanned_barcode: String(payload.scanned_barcode) } : {}),
    ...(payload.unavailable !== undefined ? { unavailable: Boolean(payload.unavailable) } : {}),
    ...(payload.unavailable_comment !== undefined
      ? { unavailable_comment: String(payload.unavailable_comment) }
      : {}),
    ...(cleanSub ? { substitute_product: cleanSub } : {}),
    ...(payload.substitute_reason !== undefined
      ? { substitute_reason: String(payload.substitute_reason) }
      : {}),
  };
}

/**
 * Lit la file d'attente persistante du Mode Scanner depuis IndexedDB (avec repli localStorage / mémoire).
 */
export async function loadScannerOfflineQueue(): Promise<ScannerOfflineAction[]> {
  try {
    if (typeof indexedDB !== 'undefined') {
      const fromIdb = await getSyncMetadata<ScannerOfflineAction[]>(SCANNER_QUEUE_META_KEY);
      if (Array.isArray(fromIdb)) {
        memoryQueueFallback = [...fromIdb];
        return [...fromIdb];
      }
    }
  } catch {
    // Repli sur localStorage / mémoire
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(SCANNER_QUEUE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          memoryQueueFallback = parsed;
          return [...parsed];
        }
      }
    } catch {
      // Ignore
    }
  }

  return [...memoryQueueFallback];
}

/**
 * Sauvegarde la file d'attente dans IndexedDB (et miroir localStorage `tot_` pour persistance synchrone et purge garantie).
 */
export async function saveScannerOfflineQueue(queue: ScannerOfflineAction[]): Promise<void> {
  memoryQueueFallback = [...queue];

  if (typeof localStorage !== 'undefined') {
    try {
      if (queue.length === 0) {
        localStorage.removeItem(SCANNER_QUEUE_STORAGE_KEY);
      } else {
        localStorage.setItem(SCANNER_QUEUE_STORAGE_KEY, JSON.stringify(queue));
      }
    } catch {
      // Ignore
    }
  }

  try {
    if (typeof indexedDB !== 'undefined') {
      await setSyncMetadata(SCANNER_QUEUE_META_KEY, queue);
    }
  } catch {
    // Ignore
  }

  notifyScannerQueueChanged();
}

/**
 * Vide intégralement la file d'attente hors ligne du Mode Scanner (appelé lors de la déconnexion / purge de sécurité).
 */
export async function clearScannerOfflineQueue(): Promise<void> {
  memoryQueueFallback = [];
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(SCANNER_QUEUE_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
  try {
    if (typeof indexedDB !== 'undefined') {
      await setSyncMetadata(SCANNER_QUEUE_META_KEY, []);
    }
  } catch {
    // Ignore
  }
  notifyScannerQueueChanged();
}

/**
 * Ajoute une action de préparation à la file d'attente locale.
 */
export async function enqueueScannerOfflineAction(params: {
  id?: string;
  order_id: string;
  order_number?: string;
  user_id: string | number;
  action_type: ScannerOfflineActionType;
  payload: ScannerOfflineActionPayload;
  created_at?: string;
}): Promise<ScannerOfflineAction> {
  const queue = await loadScannerOfflineQueue();
  const actionId = params.id || generateScannerActionId();

  // Idempotence à l'ajout : si une action avec le même ID existe déjà, ne pas la dupliquer
  const existing = queue.find((a) => a.id === actionId);
  if (existing) {
    return existing;
  }

  const action: ScannerOfflineAction = {
    id: actionId,
    order_id: String(params.order_id),
    order_number: params.order_number,
    user_id: String(params.user_id),
    action_type: params.action_type,
    payload: sanitizePayload(params.payload),
    created_at: params.created_at || new Date().toISOString(),
    status: 'pending',
  };

  queue.push(action);
  queue.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  await saveScannerOfflineQueue(queue);
  return action;
}

/**
 * Retourne le nombre d'actions en attente (`pending` ou `syncing`).
 */
export async function getPendingScannerActionsCount(): Promise<number> {
  const queue = await loadScannerOfflineQueue();
  return queue.filter((a) => a.status === 'pending' || a.status === 'syncing').length;
}

/**
 * Retourne les conflits actifs groupés par commande.
 */
export async function getScannerQueueConflicts(): Promise<ScannerOrderConflict[]> {
  const queue = await loadScannerOfflineQueue();
  const byOrder = new Map<string, ScannerOrderConflict>();

  for (const act of queue) {
    if (act.status !== 'conflict' || !act.conflict_reason) continue;
    const existing = byOrder.get(act.order_id);
    if (existing) {
      existing.actionsCount += 1;
    } else {
      byOrder.set(act.order_id, {
        order_id: act.order_id,
        order_number: act.order_number || act.order_id,
        reason: act.conflict_reason,
        message: act.conflict_message || `Conflit sur la commande ${act.order_number || act.order_id}`,
        actionsCount: 1,
      });
    }
  }

  return Array.from(byOrder.values());
}

/**
 * Abandonne toutes les actions locales en attente ou en conflit pour une commande donnée.
 */
export async function abandonOrderScannerConflict(orderId: string): Promise<void> {
  const queue = await loadScannerOfflineQueue();
  const next = queue.filter((a) => String(a.order_id) !== String(orderId));
  await saveScannerOfflineQueue(next);
}

/**
 * Applique de façon pure et idempotente une action du Mode Scanner sur un objet `MaterialOrder`.
 * Rejouer deux fois la même action produit strictement le même état (ne double jamais une quantité).
 */
export function applyScannerActionToOrder(
  order: MaterialOrder,
  action: ScannerOfflineAction
): MaterialOrder {
  const { action_type, payload, created_at } = action;
  const targetProdId = String(payload.product_id);

  const updatedItems = order.items.map((it) => {
    if (String(it.product_id) !== targetProdId) return it;

    switch (action_type) {
      case 'PICK_ITEM': {
        const exactQty =
          payload.picked_quantity !== undefined && payload.picked_quantity > 0
            ? Number(payload.picked_quantity)
            : Number(it.quantity) || 1;
        return {
          ...it,
          picked: true,
          picked_quantity: exactQty,
          scanned_barcode: payload.scanned_barcode || it.product_ref,
          scanned_at: created_at,
          unavailable: false,
          ...(payload.unavailable_comment !== undefined
            ? { unavailable_comment: payload.unavailable_comment }
            : {}),
        };
      }

      case 'MARK_UNAVAILABLE': {
        return {
          ...it,
          picked: false,
          picked_quantity: undefined,
          unavailable: payload.unavailable !== undefined ? payload.unavailable : true,
          unavailable_comment: payload.unavailable_comment || 'Article manquant',
          scanned_at: created_at,
        };
      }

      case 'SUBSTITUTE_ITEM': {
        const sub = payload.substitute_product;
        const exactQty =
          payload.picked_quantity !== undefined && payload.picked_quantity > 0
            ? Number(payload.picked_quantity)
            : Number(it.quantity) || 1;
        return {
          ...it,
          substituted: true,
          substituted_with_id: sub?.id ?? it.substituted_with_id,
          substituted_with_ref: sub?.reference ?? it.substituted_with_ref,
          substituted_with_name: sub
            ? `${sub.brand} ${sub.model}`.trim()
            : it.substituted_with_name,
          picked: true,
          picked_quantity: exactQty,
          unavailable: false,
          unavailable_comment:
            payload.substitute_reason ||
            (sub ? `Substitué par ${sub.reference} (${sub.brand} ${sub.model})` : it.unavailable_comment),
          scanned_at: created_at,
        };
      }

      case 'UNPICK_ITEM': {
        return {
          ...it,
          picked: false,
          picked_quantity: undefined,
          scanned_barcode: undefined,
          scanned_at: undefined,
          unavailable: false,
        };
      }

      default:
        return it;
    }
  });

  return {
    ...order,
    items: updatedItems,
    updated_at: created_at,
  };
}

/**
 * Vérifie si la commande distante présente un conflit empêchant l'application des actions locales.
 */
export function detectOrderSyncConflict(
  remoteOrder: MaterialOrder | null | undefined,
  actionUserId: string
): { reason: ScannerConflictReason; message: string } | null {
  if (!remoteOrder) {
    return {
      reason: 'ORDER_CANCELLED',
      message: 'La commande a été supprimée ou annulée sur le serveur.',
    };
  }

  if (remoteOrder.status === 'CANCELLED' || remoteOrder.status === 'REJECTED') {
    return {
      reason: 'ORDER_CANCELLED',
      message: `La commande ${remoteOrder.order_number} a été annulée entre-temps.`,
    };
  }

  if (remoteOrder.status === 'READY' || remoteOrder.status === 'COLLECTED') {
    return {
      reason: 'ALREADY_COMPLETED',
      message: `La commande ${remoteOrder.order_number} est déjà terminée (${remoteOrder.status}).`,
    };
  }

  if (
    remoteOrder.preparer_id !== null &&
    remoteOrder.preparer_id !== undefined &&
    String(remoteOrder.preparer_id) !== '' &&
    String(remoteOrder.preparer_id) !== String(actionUserId)
  ) {
    return {
      reason: 'TAKEN_BY_OTHER',
      message: `La commande ${remoteOrder.order_number} a été prise en charge par ${remoteOrder.preparer_name || 'un autre préparateur'}.`,
    };
  }

  return null;
}

let isReplayingScannerQueue = false;

/**
 * Rejoue dans l'ordre chronologique, une par une, les actions en attente du Mode Scanner.
 * - Idempotent : le rejeu d'une action déjà appliquée (ou son application répétée) donne exactement le même état.
 * - En cas de coupure réseau au milieu de la file : interrompt immédiatement sans perdre les actions restantes.
 * - En cas de conflit (commande annulée, prise par un autre, déjà prête) : bloque les actions de cette commande
 *   sans jamais écraser le serveur.
 */
export async function replayScannerOfflineQueue(params: {
  fetchRemoteOrder: (orderId: string) => Promise<MaterialOrder | null | undefined>;
  persistUpdatedOrder: (order: MaterialOrder, action: ScannerOfflineAction) => Promise<{
    success: boolean;
    isNetworkError?: boolean;
    error?: string;
  }>;
  onOrderUpdatedLocally?: (order: MaterialOrder) => void;
}): Promise<ReplayScannerQueueResult> {
  if (isReplayingScannerQueue) {
    const current = await loadScannerOfflineQueue();
    return {
      processed: 0,
      synced: 0,
      remainingPending: current.filter((a) => a.status === 'pending').length,
      networkInterrupted: false,
      conflicts: await getScannerQueueConflicts(),
    };
  }

  isReplayingScannerQueue = true;
  let processed = 0;
  let synced = 0;
  let networkInterrupted = false;

  try {
    const queue = await loadScannerOfflineQueue();
    // Tri chronologique strict
    queue.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    // Cache par commande pendant la session de rejeu pour chaîner les actions successives d'une même commande
    const workingOrders = new Map<string, MaterialOrder>();
    const conflictedOrders = new Set<string>();

    for (const action of queue) {
      if (action.status === 'synced') continue;
      if (action.status === 'conflict') {
        conflictedOrders.add(action.order_id);
        continue;
      }
      if (conflictedOrders.has(action.order_id)) {
        continue;
      }

      processed++;
      action.status = 'syncing';
      await saveScannerOfflineQueue(queue);

      try {
        let baseOrder = workingOrders.get(action.order_id);
        if (!baseOrder) {
          const fetched = await params.fetchRemoteOrder(action.order_id);
          const conflict = detectOrderSyncConflict(fetched, action.user_id);
          if (conflict) {
            conflictedOrders.add(action.order_id);
            for (const qItem of queue) {
              if (
                qItem.order_id === action.order_id &&
                (qItem.status === 'pending' || qItem.status === 'syncing')
              ) {
                qItem.status = 'conflict';
                qItem.conflict_reason = conflict.reason;
                qItem.conflict_message = conflict.message;
              }
            }
            await saveScannerOfflineQueue(queue);
            continue;
          }
          baseOrder = fetched!;
        }

        const nextOrder = applyScannerActionToOrder(baseOrder, action);
        const persistRes = await params.persistUpdatedOrder(nextOrder, action);

        if (persistRes.isNetworkError) {
          action.status = 'pending';
          networkInterrupted = true;
          await saveScannerOfflineQueue(queue);
          break;
        }

        if (!persistRes.success) {
          action.status = 'pending';
          await saveScannerOfflineQueue(queue);
          break;
        }

        workingOrders.set(action.order_id, nextOrder);
        if (params.onOrderUpdatedLocally) {
          params.onOrderUpdatedLocally(nextOrder);
        }

        action.status = 'synced';
        synced++;
        await saveScannerOfflineQueue(queue);
      } catch (err: any) {
        if (isNetworkOrFetchError(err)) {
          action.status = 'pending';
          networkInterrupted = true;
          await saveScannerOfflineQueue(queue);
          break;
        }
        action.status = 'pending';
        await saveScannerOfflineQueue(queue);
        break;
      }
    }

    // Nettoyer les actions synchronisées avec succès tout en conservant les actions en attente ou en conflit
    const cleanedQueue = queue.filter((a) => a.status !== 'synced');
    await saveScannerOfflineQueue(cleanedQueue);

    const conflicts = await getScannerQueueConflicts();
    return {
      processed,
      synced,
      remainingPending: cleanedQueue.filter((a) => a.status === 'pending').length,
      networkInterrupted,
      conflicts,
    };
  } finally {
    isReplayingScannerQueue = false;
  }
}
