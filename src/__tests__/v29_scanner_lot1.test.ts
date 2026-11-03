import { describe, it, expect, beforeEach } from 'vitest';
import {
  findOrderItemByCode,
  matchScannedCodeInOrder,
  compareRackLocationsNatural,
  getNextItemToPick,
  getSortedOrderItemsForPicking,
  canFinishOrder,
  getOrderProgress,
  isOrderLockedForUser,
  canUserAccessScannerMode,
  filterOrdersForPreparer,
  parseOrderQrCodePayload,
  isScannerSoundEnabled,
  setScannerSoundEnabled,
  isScannerVibrationEnabled,
  setScannerVibrationEnabled,
} from '../services/orderPickingLogic';
import { MaterialOrder, Product, User } from '../types';

const sampleProducts: Product[] = [
  {
    id: 'p1',
    reference: 'VIS-M8-50',
    brand: 'Wurth',
    model: 'Boulon M8x50',
    barcode: '3216549870001',
    qr_code: 'TOT-PROD-VIS-M8',
    manufacturer_ref: 'WR-8850',
    rack_location: 'A10',
    store_name: 'Dépôt Central',
    quantity: 100,
    min_stock_alert: 10,
    unit_price: 0.5,
  },
  {
    id: 'p2',
    reference: 'CABLE-3G25',
    brand: 'Nexans',
    model: 'Touret Câble 3G2.5',
    barcode: '3216549870002',
    rack_location: 'A2',
    store_name: 'Dépôt Central',
    quantity: 25,
    min_stock_alert: 5,
    unit_price: 45,
  },
  {
    id: 'p3',
    reference: 'GANTS-T9',
    brand: 'Honeywell',
    model: 'Gants de chantier T9',
    barcode: '3216549870003',
    rack_location: '',
    store_name: 'Dépôt Central',
    quantity: 50,
    min_stock_alert: 5,
    unit_price: 4,
  },
  {
    id: 'p4',
    reference: 'DISJ-16A-SUB',
    brand: 'Schneider',
    model: 'Disjoncteur 16A Remplaçant',
    barcode: '3216549870004',
    rack_location: 'B1',
    store_name: 'Dépôt Central',
    quantity: 15,
    min_stock_alert: 2,
    unit_price: 12,
  },
];

function createSampleOrder(): MaterialOrder {
  return {
    id: 'ord-100',
    order_number: 'CMD-2026-100',
    requester_id: 'u-req',
    requester_name: 'Jean Chantier',
    site_number: 'CH-500',
    site_name: 'Tour Nord',
    depot_name: 'Dépôt Central',
    status: 'PREPARING',
    preparer_id: 'u-prep-1',
    preparer_name: 'Marc Magasinier',
    created_at: '2026-03-10T08:00:00.000Z',
    items: [
      {
        product_id: 'p1',
        product_ref: 'VIS-M8-50',
        product_name: 'Boulon M8x50',
        quantity: 10,
        unit: 'pcs',
        picked: false,
      },
      {
        product_id: 'p2',
        product_ref: 'CABLE-3G25',
        product_name: 'Touret Câble 3G2.5',
        quantity: 2,
        unit: 'rlx',
        picked: false,
      },
      {
        product_id: 'p3',
        product_ref: 'GANTS-T9',
        product_name: 'Gants de chantier T9',
        quantity: 1,
        unit: 'paire',
        picked: false,
        substituted: true,
        substituted_with_id: 'p4',
        substituted_with_ref: 'DISJ-16A-SUB',
        substituted_with_name: 'Disjoncteur 16A Remplaçant',
      },
    ],
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

describe('Prompt v29 — Lot 1: Pure Order Picking Logic & Scanner Mode rules', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
  });

  it('findOrderItemByCode matches reference, barcode, QR, manufacturer_ref, and substitute ref (case & space insensitive)', () => {
    const order = createSampleOrder();

    expect(findOrderItemByCode(order, '  vis-m8-50 ', sampleProducts)?.product_id).toBe('p1');
    expect(findOrderItemByCode(order, '3216549870002', sampleProducts)?.product_id).toBe('p2');
    expect(findOrderItemByCode(order, 'tot-prod-vis-m8', sampleProducts)?.product_id).toBe('p1');
    expect(findOrderItemByCode(order, 'wr-8850', sampleProducts)?.product_id).toBe('p1');
    expect(findOrderItemByCode(order, 'disj-16a-sub', sampleProducts)?.product_id).toBe('p3');
    expect(findOrderItemByCode(order, '3216549870004', sampleProducts)?.product_id).toBe('p3');
    expect(findOrderItemByCode(order, 'UNKNOWN-999', sampleProducts)).toBeUndefined();
  });

  it('matchScannedCodeInOrder distinguishes expected item, other order line, already picked line, catalog substitute, and unknown code', () => {
    const order = createSampleOrder();
    order.items[0].picked = true; // p1 already picked
    const expectedItem = order.items[1]; // p2 is currently expected

    const resExpected = matchScannedCodeInOrder(order, '3216549870002', sampleProducts, expectedItem);
    expect(resExpected.kind).toBe('expected_item');
    expect(resExpected.matchedItem?.product_id).toBe('p2');

    const resOther = matchScannedCodeInOrder(order, 'GANTS-T9', sampleProducts, expectedItem);
    expect(resOther.kind).toBe('other_order_item');
    expect(resOther.matchedItem?.product_id).toBe('p3');

    const resAlready = matchScannedCodeInOrder(order, 'VIS-M8-50', sampleProducts, expectedItem);
    expect(resAlready.kind).toBe('already_picked_item');

    order.items[2].substituted = false;
    order.items[2].substituted_with_id = undefined;
    order.items[2].substituted_with_ref = undefined;
    const resCatalog = matchScannedCodeInOrder(order, 'DISJ-16A-SUB', sampleProducts, expectedItem);
    expect(resCatalog.kind).toBe('catalog_substitute_candidate');
    expect(resCatalog.catalogProduct?.id).toBe('p4');

    const resUnknown = matchScannedCodeInOrder(order, 'NOPE-000', sampleProducts, expectedItem);
    expect(resUnknown.kind).toBe('unknown_code');
  });

  it('getNextItemToPick and compareRackLocationsNatural apply natural sort (A2 before A10, empty locations last) and defer skipped items', () => {
    expect(compareRackLocationsNatural('A2', 'A10')).toBeLessThan(0);
    expect(compareRackLocationsNatural('A10', 'A2')).toBeGreaterThan(0);
    expect(compareRackLocationsNatural('B5', '')).toBeLessThan(0);
    expect(compareRackLocationsNatural('', 'A1')).toBeGreaterThan(0);

    const order = createSampleOrder();
    order.items[2].substituted = false;
    order.items[2].substituted_with_id = undefined;
    order.items[2].substituted_with_ref = undefined;

    const sorted = getSortedOrderItemsForPicking(order, {
      strategy: 'rack_location',
      products: sampleProducts,
    });
    expect(sorted.map((i) => i.product_id)).toEqual(['p2', 'p1', 'p3']);

    const firstNext = getNextItemToPick(order, {
      strategy: 'rack_location',
      products: sampleProducts,
    });
    expect(firstNext?.product_id).toBe('p2');

    const nextAfterSkip = getNextItemToPick(order, {
      strategy: 'rack_location',
      products: sampleProducts,
      skippedProductIds: ['p2'],
    });
    expect(nextAfterSkip?.product_id).toBe('p1');
  });

  it('canFinishOrder and getOrderProgress accurately validate completion rules', () => {
    const order = createSampleOrder();
    expect(canFinishOrder(order)).toBe(false);

    order.items[0].picked = true;
    order.items[0].picked_quantity = 10;
    order.items[1].unavailable = true;
    expect(canFinishOrder(order)).toBe(false);

    order.items[2].picked = true;
    order.items[2].picked_quantity = 1;
    expect(canFinishOrder(order)).toBe(true);

    const prog = getOrderProgress(order);
    expect(prog.totalLines).toBe(3);
    expect(prog.pickedLines).toBe(2);
    expect(prog.unavailableLines).toBe(1);
    expect(prog.substitutedLines).toBe(1);
    expect(prog.processedLines).toBe(3);
    expect(prog.percent).toBe(100);
    expect(prog.requestedQuantity).toBe(13);
    expect(prog.pickedQuantity).toBe(11);
  });

  it('isOrderLockedForUser blocks other preparers but allows assigned preparer and admins', () => {
    const order = createSampleOrder();

    const prep1: User = { id: 'u-prep-1', name: 'Marc', trigram: 'MMA', role_id: 3, pin_hash: '', is_blocked: false };
    const prep2: User = { id: 'u-prep-2', name: 'Paul', trigram: 'PPA', role_id: 3, pin_hash: '', is_blocked: false };
    const adminUser: User = { id: 'u-admin', name: 'Admin', trigram: 'ADM', role_id: 1, pin_hash: '', is_blocked: false };

    expect(isOrderLockedForUser(order, prep1)).toBe(false);
    expect(isOrderLockedForUser(order, prep2)).toBe(true);
    expect(isOrderLockedForUser(order, adminUser)).toBe(false);
    expect(isOrderLockedForUser(order, prep2, true)).toBe(false);
  });

  it('filterOrdersForPreparer respects allowed_depots and sorts mine first then oldest first', () => {
    const prep: User = {
      id: 'u-prep-1',
      name: 'Marc',
      trigram: 'MMA',
      role_id: 3,
      pin_hash: '',
      is_blocked: false,
      allowed_depots: ['Dépôt Nord'],
    };

    const orders: MaterialOrder[] = [
      {
        ...createSampleOrder(),
        id: 'o-newer-pending',
        order_number: 'CMD-002',
        depot_name: 'Dépôt Nord',
        status: 'PENDING',
        preparer_id: undefined,
        created_at: '2026-03-10T10:00:00.000Z',
      },
      {
        ...createSampleOrder(),
        id: 'o-older-pending',
        order_number: 'CMD-001',
        depot_name: 'Dépôt Nord',
        status: 'PENDING',
        preparer_id: undefined,
        created_at: '2026-03-10T08:00:00.000Z',
      },
      {
        ...createSampleOrder(),
        id: 'o-mine-preparing',
        order_number: 'CMD-003',
        depot_name: 'Dépôt Nord',
        status: 'PREPARING',
        preparer_id: 'u-prep-1',
        created_at: '2026-03-10T11:00:00.000Z',
      },
      {
        ...createSampleOrder(),
        id: 'o-other-depot',
        order_number: 'CMD-004',
        depot_name: 'Dépôt Sud',
        status: 'PENDING',
        preparer_id: undefined,
        created_at: '2026-03-10T07:00:00.000Z',
      },
    ];

    const filtered = filterOrdersForPreparer(orders, prep);
    expect(filtered.map((o) => o.id)).toEqual([
      'o-mine-preparing',
      'o-older-pending',
      'o-newer-pending',
    ]);
  });

  it('parseOrderQrCodePayload parses TOT-ORDER:<number> and JSON payloads', () => {
    expect(parseOrderQrCodePayload('TOT-ORDER:CMD-2026-042')).toBe('CMD-2026-042');
    expect(
      parseOrderQrCodePayload(JSON.stringify({ type: 'TOT_ORDER_PICKUP', order_number: 'CMD-2026-099' }))
    ).toBe('CMD-2026-099');
    expect(parseOrderQrCodePayload('RANDOM-BARCODE')).toBeNull();
  });

  it('stores per-device scanner sound and vibration preferences and checks access permissions', () => {
    expect(isScannerSoundEnabled()).toBe(true);
    setScannerSoundEnabled(false);
    expect(isScannerSoundEnabled()).toBe(false);

    expect(isScannerVibrationEnabled()).toBe(true);
    setScannerVibrationEnabled(false);
    expect(isScannerVibrationEnabled()).toBe(false);

    const prepUser: User = { id: 'u1', name: 'Mag', trigram: 'MAG', role_id: 3, pin_hash: '', is_blocked: false };
    expect(canUserAccessScannerMode(prepUser, true, true)).toBe(true);
    expect(canUserAccessScannerMode(prepUser, false, true)).toBe(false);
    expect(canUserAccessScannerMode(prepUser, true, false)).toBe(false);
  });
});
