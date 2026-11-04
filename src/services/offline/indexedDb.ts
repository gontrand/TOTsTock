import { openDB, IDBPDatabase } from 'idb';
import { Product, StockMovement, MaterialOrder, Depot, User, Role, Department, Project, SubCategory } from '../../types';

export const DB_NAME = 'tot_stock_offline_db';
export const DB_VERSION = 1;

export interface SyncOperation {
  operation_id: string; // UUID unique
  entity:
    | 'products'
    | 'stock_movements'
    | 'material_orders'
    | 'depots'
    | 'users'
    | 'roles'
    | 'departments'
    | 'projects'
    | 'sub_categories';
  action: 'INSERT' | 'UPDATE' | 'DELETE' | 'RPC_STOCK_MOVEMENT' | 'RPC_ORDER_TRANSITION';
  payload: any;
  created_at: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed' | 'rejected';
  retry_count: number;
  last_error?: string;
}

export type StoreName =
  | 'products'
  | 'stock_movements'
  | 'material_orders'
  | 'depots'
  | 'users'
  | 'roles'
  | 'departments'
  | 'projects'
  | 'sub_categories'
  | 'sync_queue'
  | 'sync_metadata';

let dbPromise: Promise<IDBPDatabase> | null = null;
const memoryStores = new Map<StoreName, Map<string, any>>();

function getMemoryStore(storeName: StoreName): Map<string, any> {
  if (!memoryStores.has(storeName)) {
    memoryStores.set(storeName, new Map<string, any>());
  }
  return memoryStores.get(storeName)!;
}

function getKeyField(storeName: StoreName): string {
  if (storeName === 'sync_queue') return 'operation_id';
  if (storeName === 'sync_metadata') return 'key';
  return 'id';
}

function createMemoryDbAdapter(): IDBPDatabase {
  const makeObjectStore = (storeName: StoreName) => {
    const map = getMemoryStore(storeName);
    const keyField = getKeyField(storeName);
    return {
      get: async (key: string | number) => {
        const val = map.get(String(key));
        return val ? structuredClone(val) : undefined;
      },
      getAll: async () => Array.from(map.values()).map((v) => structuredClone(v)),
      put: async (item: any) => {
        const k = String(item?.[keyField] ?? '');
        map.set(k, structuredClone(item));
        return k;
      },
      delete: async (key: string | number) => {
        map.delete(String(key));
      },
      clear: async () => {
        map.clear();
      },
      index: (indexName: string) => ({
        getAll: async (filterValue?: any) => {
          const all = Array.from(map.values()).map((v) => structuredClone(v));
          if (filterValue === undefined) return all;
          const field =
            indexName === 'by_status'
              ? 'status'
              : indexName === 'by_created_at'
                ? 'created_at'
                : indexName;
          return all.filter((item) => item?.[field] === filterValue);
        },
      }),
    };
  };

  return {
    objectStoreNames: {
      contains: (name: string) => ALL_STORE_NAMES.includes(name as StoreName),
    },
    getAll: async (storeName: StoreName) => makeObjectStore(storeName).getAll(),
    get: async (storeName: StoreName, key: string | number) =>
      makeObjectStore(storeName).get(key),
    put: async (storeName: StoreName, item: any) => makeObjectStore(storeName).put(item),
    delete: async (storeName: StoreName, key: string | number) =>
      makeObjectStore(storeName).delete(key),
    clear: async (storeName: StoreName) => makeObjectStore(storeName).clear(),
    close: () => {},
    transaction: (storeName: StoreName) => {
      const store = makeObjectStore(storeName);
      return {
        store,
        objectStore: () => store,
        done: Promise.resolve(),
      };
    },
  } as unknown as IDBPDatabase;
}

export function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    if (typeof indexedDB === 'undefined') {
      dbPromise = Promise.resolve(createMemoryDbAdapter());
      return dbPromise;
    }
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Business stores
        if (!db.objectStoreNames.contains('products')) {
          db.createObjectStore('products', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('stock_movements')) {
          db.createObjectStore('stock_movements', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('material_orders')) {
          db.createObjectStore('material_orders', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('depots')) {
          db.createObjectStore('depots', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('users')) {
          db.createObjectStore('users', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('roles')) {
          db.createObjectStore('roles', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('departments')) {
          db.createObjectStore('departments', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sub_categories')) {
          db.createObjectStore('sub_categories', { keyPath: 'id' });
        }

        // Offline sync queue
        if (!db.objectStoreNames.contains('sync_queue')) {
          const queueStore = db.createObjectStore('sync_queue', { keyPath: 'operation_id' });
          queueStore.createIndex('by_status', 'status');
          queueStore.createIndex('by_created_at', 'created_at');
        }

        // Sync metadata & incremental sync tracking
        if (!db.objectStoreNames.contains('sync_metadata')) {
          db.createObjectStore('sync_metadata', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

// -----------------------------------------------------------------------------
// Generic CRUD operations
// -----------------------------------------------------------------------------

export async function getAllFromStore<T>(storeName: StoreName): Promise<T[]> {
  try {
    const db = await getDb();
    return (await db.getAll(storeName)) as T[];
  } catch (err) {
    console.warn(`[IndexedDB] Error reading store ${storeName}:`, err);
    return [];
  }
}

export async function getByIdFromStore<T>(storeName: StoreName, id: string | number): Promise<T | undefined> {
  try {
    const db = await getDb();
    return (await db.get(storeName, id as any)) as T | undefined;
  } catch (err) {
    console.warn(`[IndexedDB] Error reading ID ${id} from ${storeName}:`, err);
    return undefined;
  }
}

export async function putToStore<T>(storeName: StoreName, item: T): Promise<void> {
  try {
    const db = await getDb();
    await db.put(storeName, item);
  } catch (err) {
    console.error(`[IndexedDB] Error writing to ${storeName}:`, err);
    throw err;
  }
}

export async function putManyToStore<T>(storeName: StoreName, items: T[]): Promise<void> {
  if (!items || items.length === 0) return;
  try {
    const db = await getDb();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const item of items) {
      await store.put(item);
    }
    await tx.done;
  } catch (err) {
    console.error(`[IndexedDB] Error batch writing to ${storeName}:`, err);
    throw err;
  }
}

export async function deleteFromStore(storeName: StoreName, id: string | number): Promise<void> {
  try {
    const db = await getDb();
    await db.delete(storeName, id as any);
  } catch (err) {
    console.error(`[IndexedDB] Error deleting ID ${id} from ${storeName}:`, err);
    throw err;
  }
}

export const ALL_STORE_NAMES: StoreName[] = [
  'products',
  'stock_movements',
  'material_orders',
  'depots',
  'users',
  'roles',
  'departments',
  'projects',
  'sub_categories',
  'sync_queue',
  'sync_metadata',
];

export async function clearStore(storeName: StoreName): Promise<void> {
  try {
    const db = await getDb();
    await db.clear(storeName);
  } catch (err) {
    console.error(`[IndexedDB] Error clearing store ${storeName}:`, err);
  }
}

/**
 * Vide intégralement tous les stores IndexedDB de l'application et supprime la base locale.
 */
export async function wipeOfflineIndexedDb(): Promise<string[]> {
  const clearedStores: string[] = [];
  try {
    if (typeof indexedDB === 'undefined') {
      dbPromise = null;
      return clearedStores;
    }
    if (dbPromise) {
      try {
        const db = await dbPromise;
        for (const storeName of ALL_STORE_NAMES) {
          if (db.objectStoreNames.contains(storeName)) {
            await db.clear(storeName);
            clearedStores.push(storeName);
          }
        }
        db.close();
      } catch {
        // Ignore if DB connection failed
      }
      dbPromise = null;
    }
    await new Promise<void>((resolve) => {
      try {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    dbPromise = null;
  }
  return clearedStores;
}

// -----------------------------------------------------------------------------
// Sync Queue Management (Priority 5 & 6)
// -----------------------------------------------------------------------------

export function generateOperationId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function enqueueSyncOperation(
  entity: SyncOperation['entity'],
  action: SyncOperation['action'],
  payload: any,
  explicitOperationId?: string
): Promise<SyncOperation> {
  const operation_id = explicitOperationId || generateOperationId();
  const op: SyncOperation = {
    operation_id,
    entity,
    action,
    payload,
    created_at: new Date().toISOString(),
    status: 'pending',
    retry_count: 0,
  };

  await putToStore('sync_queue', op);
  return op;
}

export async function getPendingSyncOperations(): Promise<SyncOperation[]> {
  try {
    const db = await getDb();
    const tx = db.transaction('sync_queue', 'readonly');
    const index = tx.store.index('by_status');
    const pending = await index.getAll('pending');
    const failed = await index.getAll('failed');
    await tx.done;

    // Sort by created_at ascending to maintain chronological order
    const all = [...pending, ...failed];
    return all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  } catch (err) {
    console.warn('[IndexedDB] Error fetching pending sync operations:', err);
    return [];
  }
}

export async function updateSyncOperationStatus(
  operation_id: string,
  status: SyncOperation['status'],
  last_error?: string
): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction('sync_queue', 'readwrite');
    const op = await tx.store.get(operation_id);
    if (op) {
      op.status = status;
      if (status === 'failed') {
        op.retry_count = (op.retry_count || 0) + 1;
      }
      if (last_error) {
        op.last_error = last_error;
      }
      await tx.store.put(op);
    }
    await tx.done;
  } catch (err) {
    console.error(`[IndexedDB] Error updating operation ${operation_id}:`, err);
  }
}

export async function pruneSyncedOperations(olderThanDays = 7): Promise<number> {
  try {
    const db = await getDb();
    const tx = db.transaction('sync_queue', 'readwrite');
    const index = tx.store.index('by_status');
    const synced = await index.getAll('synced');
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    let pruned = 0;

    for (const op of synced) {
      if (new Date(op.created_at).getTime() < cutoff) {
        await tx.store.delete(op.operation_id);
        pruned++;
      }
    }
    await tx.done;
    return pruned;
  } catch (err) {
    console.warn('[IndexedDB] Error pruning synced operations:', err);
    return 0;
  }
}

// -----------------------------------------------------------------------------
// Metadata & Incremental Sync (Priority 10)
// -----------------------------------------------------------------------------

export async function getSyncMetadata<T = any>(key: string): Promise<T | undefined> {
  try {
    const db = await getDb();
    const entry = await db.get('sync_metadata', key);
    return entry?.value;
  } catch {
    return undefined;
  }
}

export async function setSyncMetadata(key: string, value: any): Promise<void> {
  try {
    const db = await getDb();
    await db.put('sync_metadata', { key, value, updated_at: new Date().toISOString() });
  } catch (err) {
    console.error(`[IndexedDB] Error saving metadata ${key}:`, err);
  }
}

// -----------------------------------------------------------------------------
// Non-Destructive Migration from localStorage (Priority 17)
// -----------------------------------------------------------------------------

const LOCAL_PREFIX = 'tot_inv_';

export async function migrateFromLocalStorageToIndexedDb(): Promise<{
  migrated: boolean;
  counts: Record<string, number>;
}> {
  const isMigrated = await getSyncMetadata('localStorage_migrated_v1');
  if (isMigrated) {
    return { migrated: false, counts: {} };
  }

  const counts: Record<string, number> = {};

  try {
    // 1. Products
    const rawProd = localStorage.getItem(`${LOCAL_PREFIX}products`);
    if (rawProd) {
      const prods: Product[] = JSON.parse(rawProd);
      if (Array.isArray(prods) && prods.length > 0) {
        await putManyToStore('products', prods);
        counts.products = prods.length;
      }
    }

    // 2. Movements
    const rawMov = localStorage.getItem(`${LOCAL_PREFIX}movements`);
    if (rawMov) {
      const movs: StockMovement[] = JSON.parse(rawMov);
      if (Array.isArray(movs) && movs.length > 0) {
        await putManyToStore('stock_movements', movs);
        counts.movements = movs.length;
      }
    }

    // 3. Orders
    const rawOrd = localStorage.getItem(`${LOCAL_PREFIX}orders`);
    if (rawOrd) {
      const ords: MaterialOrder[] = JSON.parse(rawOrd);
      if (Array.isArray(ords) && ords.length > 0) {
        await putManyToStore('material_orders', ords);
        counts.orders = ords.length;
      }
    }

    // 4. Depots
    const rawDep = localStorage.getItem(`${LOCAL_PREFIX}depots`);
    if (rawDep) {
      const deps: Depot[] = JSON.parse(rawDep);
      if (Array.isArray(deps) && deps.length > 0) {
        await putManyToStore('depots', deps);
        counts.depots = deps.length;
      }
    }

    // 5. Users
    const rawUsers = localStorage.getItem(`${LOCAL_PREFIX}users`);
    if (rawUsers) {
      const usrs: User[] = JSON.parse(rawUsers);
      if (Array.isArray(usrs) && usrs.length > 0) {
        await putManyToStore('users', usrs);
        counts.users = usrs.length;
      }
    }

    // 6. Roles
    const rawRoles = localStorage.getItem(`${LOCAL_PREFIX}roles`);
    if (rawRoles) {
      const rls: Role[] = JSON.parse(rawRoles);
      if (Array.isArray(rls) && rls.length > 0) {
        await putManyToStore('roles', rls);
        counts.roles = rls.length;
      }
    }

    // 7. Departments
    const rawDepts = localStorage.getItem(`${LOCAL_PREFIX}departments`);
    if (rawDepts) {
      const dpts: Department[] = JSON.parse(rawDepts);
      if (Array.isArray(dpts) && dpts.length > 0) {
        await putManyToStore('departments', dpts);
        counts.departments = dpts.length;
      }
    }

    // 8. Projects
    const rawProj = localStorage.getItem(`${LOCAL_PREFIX}projects`);
    if (rawProj) {
      const prjs: Project[] = JSON.parse(rawProj);
      if (Array.isArray(prjs) && prjs.length > 0) {
        await putManyToStore('projects', prjs);
        counts.projects = prjs.length;
      }
    }

    // 9. Sub-categories
    const rawSubs = localStorage.getItem(`${LOCAL_PREFIX}subcategories`);
    if (rawSubs) {
      const subs: SubCategory[] = JSON.parse(rawSubs);
      if (Array.isArray(subs) && subs.length > 0) {
        await putManyToStore('sub_categories', subs);
        counts.sub_categories = subs.length;
      }
    }

    // Mark migration completed
    await setSyncMetadata('localStorage_migrated_v1', true);
    await setSyncMetadata('migration_date', new Date().toISOString());

    console.log('[IndexedDB] Migration from localStorage completed successfully:', counts);
    return { migrated: true, counts };
  } catch (err) {
    console.error('[IndexedDB] Error during localStorage migration:', err);
    return { migrated: false, counts };
  }
}

/**
 * Remplace atomiquement le contenu d'un store IndexedDB pour garantir qu'il reste
 * la source locale de référence (y compris après suppression d'un enregistrement).
 */
export async function replaceStoreContents<T>(storeName: StoreName, items: T[]): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    await store.clear();
    for (const item of items || []) {
      await store.put(item);
    }
    await tx.done;
  } catch (err) {
    console.warn(`[IndexedDB] Error replacing store ${storeName}:`, err);
  }
}

export interface HydratedOfflineState {
  products: Product[];
  movements: StockMovement[];
  orders: MaterialOrder[];
  depots: Depot[];
  users: User[];
  roles: Role[];
  departments: Department[];
  projects: Project[];
  subCategories: SubCategory[];
}

/**
 * Charge l'intégralité des collections métier depuis IndexedDB (source locale de référence),
 * après avoir exécuté la migration initiale depuis localStorage si nécessaire.
 */
export async function hydrateAllFromIndexedDb(): Promise<HydratedOfflineState> {
  await migrateFromLocalStorageToIndexedDb();

  const [
    products,
    movements,
    orders,
    depots,
    users,
    roles,
    departments,
    projects,
    subCategories,
  ] = await Promise.all([
    getAllFromStore<Product>('products'),
    getAllFromStore<StockMovement>('stock_movements'),
    getAllFromStore<MaterialOrder>('material_orders'),
    getAllFromStore<Depot>('depots'),
    getAllFromStore<User>('users'),
    getAllFromStore<Role>('roles'),
    getAllFromStore<Department>('departments'),
    getAllFromStore<Project>('projects'),
    getAllFromStore<SubCategory>('sub_categories'),
  ]);

  return {
    products,
    movements,
    orders,
    depots,
    users,
    roles,
    departments,
    projects,
    subCategories,
  };
}

