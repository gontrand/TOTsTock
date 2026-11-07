import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  commitStockMovement,
  formatServerMovementRejectionMessage,
  sanitizeErrorForConsole,
} from '../services/stockMovementService';
import {
  STOCK_MOVEMENTS_SQL_OUTDATED_MESSAGE,
  checkStockMovementsReadiness,
} from '../services/clientSupabase';
import {
  clearStore,
  ALL_STORE_NAMES,
  getAllFromStore,
  getPendingSyncOperations,
  getRejectedSyncOperations,
  putToStore,
  retryRejectedSyncOperation,
  discardSyncOperation,
} from '../services/offline/indexedDb';
import { Product, StockMovement } from '../types';

const SAMPLE_PRODUCT: Product = {
  id: 'prod-lot1-001',
  reference: 'REF-LOT1-001',
  brand: 'Bosch',
  model: 'Perceuse GSB 18V',
  quantity: 10,
  min_stock_alert: 2,
  unit_price: 150,
  store_name: 'Magasin Central',
  shelf_name: 'A-01',
};

const SAMPLE_MOVEMENT: StockMovement = {
  id: 'mov-lot1-001',
  product_id: SAMPLE_PRODUCT.id,
  product_ref: SAMPLE_PRODUCT.reference,
  user_id: 1,
  user_name: 'Jean Technicien',
  movement_type: 'OUT',
  type: 'OUT',
  action: 'OUT',
  quantity: 3,
  quantity_changed: 3,
  depot_name: 'Magasin Central',
  site_number: 'CH-2026-01',
  department_name: 'Électricité',
  total_cost: 450,
  created_at: new Date().toISOString(),
};

describe('v40 LOT 1 — Un mouvement ne doit jamais sembler réussi s’il n’est pas en base', () => {
  beforeEach(async () => {
    for (const store of ALL_STORE_NAMES) {
      await clearStore(store);
    }
    await putToStore('products', SAMPLE_PRODUCT);
    vi.restoreAllMocks();
  });

  it('Erreur 42883 (fonction process_stock_movement inconnue) → restaure l’état local, affiche le message SQL, ne met pas en file pending', async () => {
    const fakeClient: any = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: '42883',
          message: 'function public.process_stock_movement(...) does not exist',
        },
      }),
    };

    let localProductQty = 7; // Optimistic after OUT 3 from 10
    let localMovements: StockMovement[] = [SAMPLE_MOVEMENT];
    let displayedError = '';

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await commitStockMovement({
      client: fakeClient,
      movement: SAMPLE_MOVEMENT,
      previousProductQty: 10,
      optimisticProductQty: 7,
      currentUserId: 1,
      operationId: 'op-42883-test',
      applyServerProductState: (_pId, serverQty) => {
        localProductQty = serverQty;
      },
      rollbackLocalState: (_pId, restoredQty, movId) => {
        localProductQty = restoredQty;
        localMovements = localMovements.filter((m) => m.id !== movId);
      },
      notifyError: (msg) => {
        displayedError = msg;
      },
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe('rejected');
    expect(res.rolledBack).toBe(true);
    // 1. État local restauré
    expect(localProductQty).toBe(10);
    expect(localMovements).toHaveLength(0);

    // IndexedDB également restauré
    const idbProducts = await getAllFromStore<Product>('products');
    expect(idbProducts.find((p) => p.id === SAMPLE_PRODUCT.id)?.quantity).toBe(10);
    const idbMovements = await getAllFromStore<StockMovement>('stock_movements');
    expect(idbMovements).toHaveLength(0);

    // 2. Message visible et lisible
    expect(displayedError).toContain('Mouvement refusé par le serveur :');
    expect(displayedError).toContain(STOCK_MOVEMENTS_SQL_OUTDATED_MESSAGE);

    // 3. Rien n'est mis en file d'attente 'pending', mais marqué 'rejected' avec message pour l'écran de synchro
    const pending = await getPendingSyncOperations();
    expect(pending).toHaveLength(0);
    const rejected = await getRejectedSyncOperations();
    expect(rejected).toHaveLength(1);
    expect(rejected[0].status).toBe('rejected');
    expect(rejected[0].last_error).toContain(STOCK_MOVEMENTS_SQL_OUTDATED_MESSAGE);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('Erreur 42501 (droit refusé / RLS) → restaure l’état local, affiche le message, ne met pas en file pending', async () => {
    const fakeClient: any = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: '42501',
          message: 'permission denied for function process_stock_movement',
        },
      }),
    };

    let localProductQty = 7;
    let localMovements: StockMovement[] = [SAMPLE_MOVEMENT];
    let displayedError = '';
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await commitStockMovement({
      client: fakeClient,
      movement: SAMPLE_MOVEMENT,
      previousProductQty: 10,
      optimisticProductQty: 7,
      currentUserId: 1,
      operationId: 'op-42501-test',
      applyServerProductState: (_pId, serverQty) => {
        localProductQty = serverQty;
      },
      rollbackLocalState: (_pId, restoredQty, movId) => {
        localProductQty = restoredQty;
        localMovements = localMovements.filter((m) => m.id !== movId);
      },
      notifyError: (msg) => {
        displayedError = msg;
      },
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe('rejected');
    expect(localProductQty).toBe(10);
    expect(localMovements).toHaveLength(0);
    expect(displayedError).toContain('Mouvement refusé par le serveur :');
    expect(displayedError).toContain('42501');

    const pending = await getPendingSyncOperations();
    expect(pending).toHaveLength(0);
    const rejected = await getRejectedSyncOperations();
    expect(rejected).toHaveLength(1);
    expect(rejected[0].id).toBe('op-42501-test');
  });

  it('Erreur P0001 / règle métier (dépôt inconnu, stock insuffisant, licence) → restaure l’état local, affiche le message, ne met pas en file pending', async () => {
    const fakeClient: any = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          success: false,
          error_code: 'P0001',
          message: 'Dépôt "Dépôt Fantôme" introuvable ou fermé.',
        },
        error: null,
      }),
    };

    let localProductQty = 7;
    let localMovements: StockMovement[] = [SAMPLE_MOVEMENT];
    let displayedError = '';
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await commitStockMovement({
      client: fakeClient,
      movement: SAMPLE_MOVEMENT,
      previousProductQty: 10,
      optimisticProductQty: 7,
      currentUserId: 1,
      operationId: 'op-p0001-test',
      applyServerProductState: (_pId, serverQty) => {
        localProductQty = serverQty;
      },
      rollbackLocalState: (_pId, restoredQty, movId) => {
        localProductQty = restoredQty;
        localMovements = localMovements.filter((m) => m.id !== movId);
      },
      notifyError: (msg) => {
        displayedError = msg;
      },
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe('rejected');
    expect(localProductQty).toBe(10);
    expect(localMovements).toHaveLength(0);
    expect(displayedError).toBe(
      'Mouvement refusé par le serveur : Dépôt "Dépôt Fantôme" introuvable ou fermé.'
    );

    const pending = await getPendingSyncOperations();
    expect(pending).toHaveLength(0);

    // Test « Réessayer » et « Abandonner » sur le mouvement rejeté
    const rejectedBefore = await getRejectedSyncOperations();
    expect(rejectedBefore).toHaveLength(1);

    await retryRejectedSyncOperation('op-p0001-test');
    const pendingAfterRetry = await getPendingSyncOperations();
    expect(pendingAfterRetry).toHaveLength(1);
    expect(pendingAfterRetry[0].status).toBe('pending');

    await discardSyncOperation('op-p0001-test');
    expect(await getPendingSyncOperations()).toHaveLength(0);
    expect(await getRejectedSyncOperations()).toHaveLength(0);
  });

  it('Erreur réseau (Failed to fetch) → conserve la mise à jour optimiste et met en file d’attente pending', async () => {
    const fakeClient: any = {
      rpc: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    };

    let localProductQty = 7;
    let localMovements: StockMovement[] = [SAMPLE_MOVEMENT];
    let displayedError = '';

    const res = await commitStockMovement({
      client: fakeClient,
      movement: SAMPLE_MOVEMENT,
      previousProductQty: 10,
      optimisticProductQty: 7,
      currentUserId: 1,
      operationId: 'op-net-test',
      applyServerProductState: (_pId, serverQty) => {
        localProductQty = serverQty;
      },
      rollbackLocalState: (_pId, restoredQty, movId) => {
        localProductQty = restoredQty;
        localMovements = localMovements.filter((m) => m.id !== movId);
      },
      notifyError: (msg) => {
        displayedError = msg;
      },
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('queued_offline');
    expect(res.rolledBack).toBe(false);
    expect(localProductQty).toBe(7);
    expect(localMovements).toHaveLength(1);
    expect(displayedError).toBe('');

    const pending = await getPendingSyncOperations();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('op-net-test');
    expect(pending[0].status).toBe('pending');
  });

  it('Succès serveur → applique l’état retourné par le serveur (new_quantity, depot_quantity)', async () => {
    const fakeClient: any = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          success: true,
          new_quantity: 7,
          depot_quantity: 7,
        },
        error: null,
      }),
    };

    let localProductQty = 7;
    let localDepotQty = 10;
    let localMovements: StockMovement[] = [SAMPLE_MOVEMENT];

    const res = await commitStockMovement({
      client: fakeClient,
      movement: SAMPLE_MOVEMENT,
      previousProductQty: 10,
      optimisticProductQty: 7,
      currentUserId: 1,
      operationId: 'op-ok-test',
      applyServerProductState: (_pId, serverQty, depotQty) => {
        localProductQty = serverQty;
        if (typeof depotQty === 'number') localDepotQty = depotQty;
      },
      rollbackLocalState: () => {
        localProductQty = 10;
        localMovements = [];
      },
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('committed');
    expect(localProductQty).toBe(7);
    expect(localDepotQty).toBe(7);
    expect(localMovements).toHaveLength(1);
    expect(await getPendingSyncOperations()).toHaveLength(0);
    expect(await getRejectedSyncOperations()).toHaveLength(0);
  });

  it('Journalisation sécurisée : masque les jetons JWT et les codes PIN dans les logs console', () => {
    const rawErr = {
      code: '42501',
      message: 'Auth error with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      pin: '1234',
      details: 'pin=9876',
    };
    const sanitized = sanitizeErrorForConsole(rawErr) as any;
    expect(JSON.stringify(sanitized)).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(JSON.stringify(sanitized)).not.toContain('1234');
    expect(JSON.stringify(sanitized)).not.toContain('9876');
    expect(sanitized.pin).toBe('[REDACTED]');
    expect(formatServerMovementRejectionMessage('Stock insuffisant')).toBe(
      'Mouvement refusé par le serveur : Stock insuffisant'
    );
  });

  it('Contrôle Diagnostic « Mouvements de stock » : détecte si process_stock_movement ou stock_levels est absent', async () => {
    const outdatedClient: any = {
      rpc: vi.fn().mockImplementation((fnName: string) => {
        if (fnName === 'diagnostic_installation') {
          return Promise.resolve({ data: null, error: { code: '42883', message: 'does not exist' } });
        }
        return Promise.resolve({
          data: null,
          error: { code: '42883', message: 'function public.process_stock_movement does not exist' },
        });
      }),
      from: vi.fn().mockReturnValue({
        select: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    };

    const readiness = await checkStockMovementsReadiness(outdatedClient);
    expect(readiness.ready).toBe(false);
    expect(readiness.message).toBe(
      "Le serveur n'a pas la dernière version des scripts SQL (03, 04) : exécutez dist/install.sql"
    );
  });

  it('AppContext.tsx n’appelle plus jamais pushMovementToSupabase directement et passe tous les mouvements par commitStockMovement', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const appCtxSource = fs.readFileSync(
      path.resolve(__dirname, '../context/AppContext.tsx'),
      'utf-8'
    );
    expect(appCtxSource).not.toContain('pushMovementToSupabase');
    const commitCalls = appCtxSource.match(/await\s+commitStockMovement\s*\(/g) || [];
    // 6 points d'appel : confirmBatchMovements, transferStockBetweenDepots, addProductToDepot, markOrderCollected, saveProduct, applyInventoryAdjustments
    expect(commitCalls.length).toBeGreaterThanOrEqual(6);
  });
});

