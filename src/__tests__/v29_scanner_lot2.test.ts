import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueueScannerOfflineAction,
  loadScannerOfflineQueue,
  clearScannerOfflineQueue,
  applyScannerActionToOrder,
  detectOrderSyncConflict,
  replayScannerOfflineQueue,
  getScannerQueueConflicts,
  abandonOrderScannerConflict,
} from '../services/scannerOfflineQueue';
import { wipeDeviceLocalData } from '../services/deviceSecurityService';
import { MaterialOrder } from '../types';

function makeBaseOrder(overrides?: Partial<MaterialOrder>): MaterialOrder {
  return {
    id: 'ord-500',
    order_number: 'CMD-2026-500',
    requester_id: 'req-1',
    requester_name: 'Alice Chef',
    site_number: 'CH-500',
    depot_name: 'Dépôt Central',
    status: 'PREPARING',
    preparer_id: 'prep-1',
    preparer_name: 'Marc Magasinier',
    created_at: '2026-03-15T08:00:00.000Z',
    items: [
      {
        product_id: 'p1',
        product_ref: 'REF-1',
        product_name: 'Article 1',
        quantity: 5,
        unit: 'pcs',
        picked: false,
      },
      {
        product_id: 'p2',
        product_ref: 'REF-2',
        product_name: 'Article 2',
        quantity: 3,
        unit: 'pcs',
        picked: false,
      },
    ],
    ...overrides,
  };
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

describe('Prompt v29 — Lot 2: Scanner Mode Offline Queue, Idempotency & Conflict Resolution', () => {
  beforeEach(async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    await clearScannerOfflineQueue();
  });

  it('persists queued actions across reload and replays them in chronological order', async () => {
    const a1 = await enqueueScannerOfflineAction({
      order_id: 'ord-500',
      order_number: 'CMD-2026-500',
      user_id: 'prep-1',
      action_type: 'PICK_ITEM',
      payload: {
        product_id: 'p1',
        product_ref: 'REF-1',
        picked_quantity: 5,
        scanned_barcode: 'REF-1',
      },
      created_at: '2026-03-15T09:00:01.000Z',
    });

    const a2 = await enqueueScannerOfflineAction({
      order_id: 'ord-500',
      order_number: 'CMD-2026-500',
      user_id: 'prep-1',
      action_type: 'MARK_UNAVAILABLE',
      payload: {
        product_id: 'p2',
        product_ref: 'REF-2',
        unavailable: true,
        unavailable_comment: 'Rupture rayon',
      },
      created_at: '2026-03-15T09:00:05.000Z',
    });

    const loaded = await loadScannerOfflineQueue();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].id).toBe(a1.id);
    expect(loaded[1].id).toBe(a2.id);

    const executedIds: string[] = [];
    const serverOrder = makeBaseOrder();

    const replayResult = await replayScannerOfflineQueue({
      fetchRemoteOrder: async () => serverOrder,
      persistUpdatedOrder: async (_updatedOrder, action) => {
        executedIds.push(action.id);
        return { success: true };
      },
    });

    expect(replayResult.synced).toBe(2);
    expect(replayResult.remainingPending).toBe(0);
    expect(executedIds).toEqual([a1.id, a2.id]);
    expect(await loadScannerOfflineQueue()).toHaveLength(0);
  });

  it('is strictly idempotent: applying the same PICK_ITEM action twice never doubles the quantity', async () => {
    const action = await enqueueScannerOfflineAction({
      order_id: 'ord-500',
      order_number: 'CMD-2026-500',
      user_id: 'prep-1',
      action_type: 'PICK_ITEM',
      payload: {
        product_id: 'p1',
        product_ref: 'REF-1',
        picked_quantity: 4,
        scanned_barcode: 'REF-1',
      },
    });

    const orderOnce = applyScannerActionToOrder(makeBaseOrder(), action);
    const orderTwice = applyScannerActionToOrder(orderOnce, action);

    const itemOnce = orderOnce.items.find((i) => i.product_id === 'p1')!;
    const itemTwice = orderTwice.items.find((i) => i.product_id === 'p1')!;

    expect(itemOnce.picked).toBe(true);
    expect(itemOnce.picked_quantity).toBe(4);
    expect(itemTwice.picked).toBe(true);
    expect(itemTwice.picked_quantity).toBe(4);
  });

  it('detects conflicts (order taken by another preparer, cancelled, or already ready) without overwriting server state', async () => {
    await enqueueScannerOfflineAction({
      order_id: 'ord-500',
      order_number: 'CMD-2026-500',
      user_id: 'prep-1',
      action_type: 'PICK_ITEM',
      payload: {
        product_id: 'p1',
        product_ref: 'REF-1',
        picked_quantity: 5,
      },
    });

    const serverOrderTakenByOther = makeBaseOrder({
      preparer_id: 'prep-99',
      preparer_name: 'Autre Magasinier',
    });

    let serverExecuted = false;
    const res = await replayScannerOfflineQueue({
      fetchRemoteOrder: async () => serverOrderTakenByOther,
      persistUpdatedOrder: async () => {
        serverExecuted = true;
        return { success: true };
      },
    });

    expect(serverExecuted).toBe(false);
    expect(res.synced).toBe(0);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].order_id).toBe('ord-500');
    expect(res.conflicts[0].reason).toBe('TAKEN_BY_OTHER');

    const conflicts = await getScannerQueueConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toBe('TAKEN_BY_OTHER');

    expect(detectOrderSyncConflict(null, 'prep-1')?.reason).toBe('ORDER_CANCELLED');
    expect(detectOrderSyncConflict(makeBaseOrder({ status: 'CANCELLED' }), 'prep-1')?.reason).toBe(
      'ORDER_CANCELLED'
    );
    expect(detectOrderSyncConflict(makeBaseOrder({ status: 'READY' }), 'prep-1')?.reason).toBe(
      'ALREADY_COMPLETED'
    );

    await abandonOrderScannerConflict('ord-500');
    expect(await loadScannerOfflineQueue()).toHaveLength(0);
  });

  it('stops replay cleanly if network drops mid-replay and keeps remaining actions in queue', async () => {
    await enqueueScannerOfflineAction({
      id: 'act-1',
      order_id: 'ord-500',
      order_number: 'CMD-2026-500',
      user_id: 'prep-1',
      action_type: 'PICK_ITEM',
      payload: { product_id: 'p1', picked_quantity: 5 },
      created_at: '2026-03-15T09:00:01.000Z',
    });
    await enqueueScannerOfflineAction({
      id: 'act-2',
      order_id: 'ord-500',
      order_number: 'CMD-2026-500',
      user_id: 'prep-1',
      action_type: 'PICK_ITEM',
      payload: { product_id: 'p2', picked_quantity: 3 },
      created_at: '2026-03-15T09:00:02.000Z',
    });

    const res = await replayScannerOfflineQueue({
      fetchRemoteOrder: async () => makeBaseOrder(),
      persistUpdatedOrder: async (_order, action) => {
        if (action.id === 'act-1') {
          return { success: true };
        }
        return { success: false, isNetworkError: true, error: 'Failed to fetch' };
      },
    });

    expect(res.synced).toBe(1);
    expect(res.networkInterrupted).toBe(true);
    expect(res.remainingPending).toBe(1);

    const remaining = await loadScannerOfflineQueue();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('act-2');
  });

  it('wipes the scanner offline queue when wipeDeviceLocalData is called (logout or 5th failed PIN)', async () => {
    await enqueueScannerOfflineAction({
      order_id: 'ord-500',
      order_number: 'CMD-2026-500',
      user_id: 'prep-1',
      action_type: 'PICK_ITEM',
      payload: { product_id: 'p1', picked_quantity: 5 },
    });
    expect(await loadScannerOfflineQueue()).toHaveLength(1);

    await wipeDeviceLocalData();
    expect(await loadScannerOfflineQueue()).toHaveLength(0);
  });
});
