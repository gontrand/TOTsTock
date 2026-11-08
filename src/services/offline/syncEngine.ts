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
  deleteFromStore,
} from './indexedDb';
import {
  isNetworkOrFetchError,
  upsertOrderToSupabase,
  recordInventoryAuditToSupabase,
  normalizeProductRecord,
  normalizeMovementRecord,
  normalizeOrderRecord,
} from '../clientSupabase';
import {
  formatServerMovementRejectionMessage,
  sanitizeErrorForConsole,
} from '../stockMovementService';
import { TABLES, resolvePrefixedTableName } from '../../constants/tables';
import { Product, MaterialOrder } from '../../types';

export interface RolledBackMovementInfo {
  operation_id: string;
  local_movement_id?: string;
  movement_id?: string;
  product_id: string;
  previous_product_qty?: number;
  previous_store_name?: string;
  previous_shelf_name?: string;
  error_message: string;
  message: string;
}

export interface SyncEngineResult {
  success: boolean;
  processedCount: number;
  syncedCount: number;
  failedCount: number;
  rejectedCount: number;
  conflicts: Array<{ operation_id: string; message: string; details?: any }>;
  updatedProductQuantities?: Array<{ product_id: string; new_quantity: number; depot_quantity?: number; dest_depot_quantity?: number }>;
  updatedOrders?: Array<{ id: string; order_number: string }>;
  rolledBackMovements?: RolledBackMovementInfo[];
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
      rolledBackMovements: [],
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
      rolledBackMovements: [],
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
    rolledBackMovements: [],
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
          const movType = String(op.payload.type || 'OUT').toUpperCase();
          const defaultAction =
            movType === 'TRANSFER'
              ? 'STOCK_TRANSFER'
              : movType === 'INVENTORY'
              ? 'STOCK_INVENTORY'
              : 'STOCK_DIRECT_MOVE';
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
            p_action: op.payload.action || op.payload.metadata?.action || defaultAction,
          });

          if (error) {
            if (isNetworkOrFetchError(error)) {
              throw error; // trigger retry on network error
            }
            console.error('[TOT Stock][SyncEngine] RPC movement rejected:', sanitizeErrorForConsole(error));
            rejectReason = formatServerMovementRejectionMessage(error.message);
            if (error.code === '23514' || error.message?.includes('Stock insuffisant')) {
              result.conflicts.push({
                operation_id: op.operation_id,
                message: rejectReason,
                details: error,
              });
            }
          } else if (data && data.success === false) {
            console.error('[TOT Stock][SyncEngine] RPC movement returned failure:', sanitizeErrorForConsole(data));
            rejectReason = formatServerMovementRejectionMessage(
              data.message || 'Mouvement rejeté par le serveur.'
            );
            result.conflicts.push({
              operation_id: op.operation_id,
              message: rejectReason,
              details: data,
            });
          } else {
            opSuccess = true;
            if (data && typeof data.new_quantity === 'number' && op.payload.product_id) {
              const prodId = String(op.payload.product_id);
              result.updatedProductQuantities?.push({
                product_id: prodId,
                new_quantity: data.new_quantity,
                depot_quantity: data.depot_quantity,
                dest_depot_quantity: data.dest_depot_quantity,
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

          if (!opSuccess && rejectReason) {
            const prodId = String(op.payload.product_id || '');
            const localMovId = op.payload.local_movement_id || op.payload.metadata?.local_movement_id;
            const prevQty =
              typeof op.payload.previous_product_qty === 'number'
                ? op.payload.previous_product_qty
                : typeof op.payload.metadata?.previous_product_qty === 'number'
                ? op.payload.metadata.previous_product_qty
                : undefined;
            const prevStore =
              op.payload.previous_store_name ?? op.payload.metadata?.previous_store_name;
            const prevShelf =
              op.payload.previous_shelf_name ?? op.payload.metadata?.previous_shelf_name;

            if (localMovId) {
              await deleteFromStore('stock_movements', String(localMovId)).catch(() => {});
            }
            if (prodId && typeof prevQty === 'number') {
              try {
                const existingProd = await getByIdFromStore<Product>('products', prodId);
                if (existingProd) {
                  await putToStore('products', {
                    ...existingProd,
                    quantity: prevQty,
                    ...(prevStore ? { store_name: prevStore } : {}),
                    ...(prevShelf ? { shelf_name: prevShelf } : {}),
                  });
                }
              } catch {}
            }
            result.rolledBackMovements?.push({
              operation_id: op.operation_id,
              local_movement_id: localMovId ? String(localMovId) : undefined,
              movement_id: localMovId ? String(localMovId) : undefined,
              product_id: prodId,
              previous_product_qty: prevQty,
              previous_store_name: prevStore,
              previous_shelf_name: prevShelf,
              error_message: rejectReason,
              message: rejectReason,
            });
          }
        } else if (op.action === 'RPC_STOCK_TRANSFER_BATCH') {
          const batchId = op.payload?.p_batch_id || op.operation_id;
          const { data, error } = await client.rpc('send_stock_transfer', {
            p_batch_id: batchId,
            p_source_depot: op.payload?.p_source_depot || null,
            p_dest_depot: op.payload?.p_dest_depot || null,
            p_items: Array.isArray(op.payload?.p_items) ? op.payload.p_items : [],
            p_reason: op.payload?.p_reason ?? null,
          });

          if (error) {
            if (isNetworkOrFetchError(error)) {
              throw error;
            }
            console.error(
              '[TOT Stock][SyncEngine] RPC send_stock_transfer rejected:',
              sanitizeErrorForConsole(error)
            );
            rejectReason = error.message || formatServerMovementRejectionMessage(error.message);
            result.conflicts.push({
              operation_id: op.operation_id,
              message: rejectReason,
              details: error,
            });
          } else if (data && data.success === false) {
            console.error(
              '[TOT Stock][SyncEngine] RPC send_stock_transfer returned failure:',
              sanitizeErrorForConsole(data)
            );
            rejectReason =
              data.message ||
              formatServerMovementRejectionMessage('Transfert rejeté par le serveur.');
            result.conflicts.push({
              operation_id: op.operation_id,
              message: rejectReason || 'Transfert rejeté par le serveur.',
              details: data,
            });
          } else {
            opSuccess = true;
            if (data && Array.isArray(data.items)) {
              for (const itemRes of data.items) {
                if (itemRes?.product_id && typeof itemRes.total_quantity === 'number') {
                  result.updatedProductQuantities?.push({
                    product_id: String(itemRes.product_id),
                    new_quantity: itemRes.total_quantity,
                    depot_quantity: itemRes.source_depot_quantity,
                    dest_depot_quantity: itemRes.dest_depot_quantity,
                  });
                }
              }
            }
          }

          if (!opSuccess && rejectReason) {
            const movIds: string[] = Array.isArray(op.payload?.local_movement_ids)
              ? op.payload.local_movement_ids
              : [];
            for (const mid of movIds) {
              if (mid) {
                await deleteFromStore('stock_movements', String(mid)).catch(() => {});
              }
            }
            const snapshots = Array.isArray(op.payload?.rollback_snapshots)
              ? op.payload.rollback_snapshots
              : [];
            for (const snap of snapshots) {
              result.rolledBackMovements?.push({
                operation_id: op.operation_id,
                local_movement_id: snap.localMovementId ? String(snap.localMovementId) : undefined,
                movement_id: snap.localMovementId ? String(snap.localMovementId) : undefined,
                product_id: String(snap.productId || ''),
                error_message: rejectReason,
                message: rejectReason,
              });
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
          const targetTable = resolvePrefixedTableName(op.entity);
          if (targetTable === TABLES.materialOrders) {
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
            const { error } = await client.from(targetTable).upsert([op.payload]);
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
          const targetTable = resolvePrefixedTableName(op.entity);
          // Standard delete
          const { error } = await client.from(targetTable).delete().eq('id', op.payload.id);
          if (error) {
            if (isNetworkOrFetchError(error)) {
              throw error;
            }
            rejectReason = error.message;
          } else {
            opSuccess = true;
          }
        } else if (op.action === 'RECORD_INVENTORY_AUDIT') {
          const auditRes = await recordInventoryAuditToSupabase(
            client,
            {
              ...op.payload,
              id: op.payload?.id || op.operation_id,
            },
            {
              skipQueue: true,
              operationId: op.operation_id,
            }
          );
          if (auditRes.isNetworkError) {
            throw new Error(auditRes.error || 'Failed to fetch');
          }
          if (auditRes.success) {
            opSuccess = true;
          } else {
            rejectReason =
              auditRes.error || "Impossible d'enregistrer l'historique d'audit.";
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
    let prodQuery = client.from(TABLES.products).select('*');
    if (lastSync) {
      prodQuery = prodQuery.gt('updated_at', lastSync);
    }
    const { data: prods, error: prodErr } = await prodQuery;
    if (!prodErr && prods && prods.length > 0) {
      await putManyToStore('products', prods.map(normalizeProductRecord));
    }

    // 2. Stock movements created since lastSync (uses created_at column)
    let movQuery = client.from(TABLES.movements).select('*');
    if (lastSync) {
      movQuery = movQuery.gt('created_at', lastSync);
    }
    const { data: movs, error: movErr } = await movQuery;
    if (!movErr && movs && movs.length > 0) {
      await putManyToStore('stock_movements', movs.map(normalizeMovementRecord));
    }

    // 3. Orders updated since lastSync
    let ordQuery = client.from(TABLES.materialOrders).select('*');
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

