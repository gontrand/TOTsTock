import { SupabaseClient } from '@supabase/supabase-js';
import {
  getPendingSyncOperations,
  updateSyncOperationStatus,
  SyncOperation,
  setSyncMetadata,
  getSyncMetadata,
  putToStore,
  putManyToStore,
  getByIdFromStore,
} from './indexedDb';
import {
  isNetworkOrFetchError,
  upsertOrderToSupabase,
  normalizeProductRecord,
  normalizeMovementRecord,
  normalizeOrderRecord,
} from '../clientSupabase';
import { Product, MaterialOrder } from '../../types';

export interface SyncEngineResult {
  success: boolean;
  processedCount: number;
  syncedCount: number;
  failedCount: number;
  rejectedCount: number;
  conflicts: Array<{ operation_id: string; message: string; details?: any }>;
  updatedProductQuantities?: Array<{ product_id: string; new_quantity: number; depot_quantity?: number }>;
  updatedOrders?: Array<{ id: string; order_number: string }>;
}

let isSyncRunning = false;

/**
 * Processes all pending operations in the sync_queue sequentially against the Supabase client.
 * Enforces server idempotency (operation_id), TRANSFER/INVENTORY parameters, _OFF order reconciliation,
 * and explicit rejection handling.
 */
export async function processSyncQueue(client: SupabaseClient | null): Promise<SyncEngineResult> {
  if (!client) {
    return {
      success: false,
      processedCount: 0,
      syncedCount: 0,
      failedCount: 0,
      rejectedCount: 0,
      conflicts: [],
      updatedProductQuantities: [],
      updatedOrders: [],
    };
  }

  if (isSyncRunning) {
    return {
      success: true,
      processedCount: 0,
      syncedCount: 0,
      failedCount: 0,
      rejectedCount: 0,
      conflicts: [],
      updatedProductQuantities: [],
      updatedOrders: [],
    };
  }

  isSyncRunning = true;
  const result: SyncEngineResult = {
    success: true,
    processedCount: 0,
    syncedCount: 0,
    failedCount: 0,
    rejectedCount: 0,
    conflicts: [],
    updatedProductQuantities: [],
    updatedOrders: [],
  };

  try {
    const queue = await getPendingSyncOperations();
    result.processedCount = queue.length;

    for (const op of queue) {
      // Mark as syncing
      await updateSyncOperationStatus(op.operation_id, 'syncing');

      try {
        let opSuccess = false;
        let rejectReason: string | undefined;

        if (op.action === 'RPC_STOCK_MOVEMENT') {
          // Transactional server RPC (supports IN, OUT, TRANSFER, INVENTORY, RETURN, LOSS)
          const { data, error } = await client.rpc('process_stock_movement', {
            p_operation_id: op.operation_id,
            p_product_id: String(op.payload.product_id),
            p_depot_name: op.payload.depot_name || null,
            p_type: op.payload.type,
            p_quantity: op.payload.quantity,
            p_reason: op.payload.reason || null,
            p_project_name: op.payload.project_name || null,
            p_department: op.payload.department || null,
            p_dest_depot_name:
              op.payload.dest_depot_name || op.payload.metadata?.dest_depot_name || null,
            p_dest_rack: op.payload.dest_rack || op.payload.metadata?.dest_rack || null,
            p_metadata: op.payload.metadata || {},
          });

          if (error) {
            if (isNetworkOrFetchError(error)) {
              throw error; // trigger retry on network error
            }
            rejectReason = error.message;
            if (error.code === '23514' || error.message?.includes('Stock insuffisant')) {
              result.conflicts.push({
                operation_id: op.operation_id,
                message: error.message,
                details: error,
              });
            }
          } else if (data && data.success === false) {
            rejectReason = data.message || 'Mouvement rejeté par le serveur.';
            const conflictMsg = rejectReason || 'Mouvement rejeté par le serveur.';
            if (data.error_code === 'REJECTED_STOCK_CONFLICT') {
              result.conflicts.push({
                operation_id: op.operation_id,
                message: conflictMsg,
                details: data,
              });
            }
          } else {
            opSuccess = true;
            if (data && typeof data.new_quantity === 'number' && op.payload.product_id) {
              const prodId = String(op.payload.product_id);
              result.updatedProductQuantities?.push({
                product_id: prodId,
                new_quantity: data.new_quantity,
                depot_quantity: data.depot_quantity,
              });
              try {
                const existingProd = await getByIdFromStore<Product>('products', prodId);
                if (existingProd) {
                  await putToStore('products', {
                    ...existingProd,
                    quantity: data.new_quantity,
                  });
                }
              } catch {}
            }
          }
        } else if (op.action === 'RPC_ORDER_TRANSITION') {
          // Transactional order transition RPC
          const { data, error } = await client.rpc('transition_order_status', {
            p_operation_id: op.operation_id,
            p_order_id: op.payload.order_id,
            p_target_status: op.payload.target_status,
            p_comment: op.payload.comment || null,
            p_preparer_id: op.payload.preparer_id || op.payload.assigned_preparer || null,
          });

          if (error) {
            if (isNetworkOrFetchError(error)) {
              throw error;
            }
            rejectReason = error.message;
          } else if (data && data.success === false) {
            rejectReason = data.message;
          } else {
            opSuccess = true;
          }
        } else if (op.action === 'INSERT' || op.action === 'UPDATE') {
          if (op.entity === 'material_orders') {
            const ordRes = await upsertOrderToSupabase(client, op.payload);
            if (ordRes.isNetworkError) {
              throw new Error(ordRes.error || 'Failed to fetch');
            }
            if (ordRes.success) {
              opSuccess = true;
              const finalOrderNum = ordRes.orderNumber || op.payload.order_number;
              if (finalOrderNum && op.payload.id) {
                const updatedOrder: MaterialOrder = {
                  ...op.payload,
                  order_number: finalOrderNum,
                };
                await putToStore('material_orders', updatedOrder).catch(() => {});
                result.updatedOrders?.push({
                  id: String(op.payload.id),
                  order_number: finalOrderNum,
                });
              }
            } else {
              rejectReason = ordRes.error;
            }
          } else {
            // Standard upsert
            const { error } = await client.from(op.entity).upsert([op.payload]);
            if (error) {
              if (isNetworkOrFetchError(error)) {
                throw error;
              }
              rejectReason = error.message;
            } else {
              opSuccess = true;
            }
          }
        } else if (op.action === 'DELETE') {
          // Standard delete
          const { error } = await client.from(op.entity).delete().eq('id', op.payload.id);
          if (error) {
            if (isNetworkOrFetchError(error)) {
              throw error;
            }
            rejectReason = error.message;
          } else {
            opSuccess = true;
          }
        }

        if (opSuccess) {
          await updateSyncOperationStatus(op.operation_id, 'synced');
          result.syncedCount++;
        } else {
          await updateSyncOperationStatus(op.operation_id, 'rejected', rejectReason);
          result.rejectedCount++;
        }
      } catch (err: any) {
        if (isNetworkOrFetchError(err)) {
          // Network interruption: keep in queue with 'failed' status for automatic retry
          await updateSyncOperationStatus(op.operation_id, 'failed', err.message || 'Réseau indisponible');
          result.failedCount++;
          // Bail early to avoid pounding an unreachable network
          result.success = false;
          break;
        } else {
          await updateSyncOperationStatus(op.operation_id, 'rejected', err?.message || 'Erreur inattendue');
          result.rejectedCount++;
        }
      }
    }
  } finally {
    isSyncRunning = false;
  }

  return result;
}

/**
 * Performs incremental sync from Supabase into IndexedDB based on updated_at / created_at.
 */
export async function performIncrementalSync(client: SupabaseClient | null): Promise<boolean> {
  if (!client) return false;

  try {
    const lastSync = await getSyncMetadata<string>('last_incremental_sync_at');
    const nowIso = new Date().toISOString();

    // 1. Products updated since lastSync
    let prodQuery = client.from('products').select('*');
    if (lastSync) {
      prodQuery = prodQuery.gt('updated_at', lastSync);
    }
    const { data: prods, error: prodErr } = await prodQuery;
    if (!prodErr && prods && prods.length > 0) {
      await putManyToStore('products', prods.map(normalizeProductRecord));
    }

    // 2. Stock movements created since lastSync (uses created_at column)
    let movQuery = client.from('stock_movements').select('*');
    if (lastSync) {
      movQuery = movQuery.gt('created_at', lastSync);
    }
    const { data: movs, error: movErr } = await movQuery;
    if (!movErr && movs && movs.length > 0) {
      await putManyToStore('stock_movements', movs.map(normalizeMovementRecord));
    }

    // 3. Orders updated since lastSync
    let ordQuery = client.from('material_orders').select('*');
    if (lastSync) {
      ordQuery = ordQuery.gt('updated_at', lastSync);
    }
    const { data: ords, error: ordErr } = await ordQuery;
    if (!ordErr && ords && ords.length > 0) {
      await putManyToStore('material_orders', ords.map(normalizeOrderRecord));
    }

    // Update metadata timestamp
    await setSyncMetadata('last_incremental_sync_at', nowIso);
    return true;
  } catch (err) {
    console.warn('[SyncEngine] Error during incremental sync:', err);
    return false;
  }
}

