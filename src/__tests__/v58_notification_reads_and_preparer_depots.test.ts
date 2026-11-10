import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { APP_VERSION, EXPECTED_SCHEMA_VERSION } from '../appVersion';
import {
  buildNotificationKey,
  shouldAutoDismissOnCardClick,
  isOrderNotificationExpired,
  shouldWarnPreparerWithoutDepot,
  isUserAuthorizedPreparerForOrder,
  isUserRecipientForOrderEvent,
  getTargetedOrderNotificationsForUser,
  computeTargetedBellBadgeCount,
  shouldEmitNotificationBeep,
  shouldShowNotificationBanner,
  getNotificationCardDescriptor,
} from '../services/notificationService';
import {
  loadMyDismissedKeys,
  dismissNotifications,
  clearMyDismissals,
  getDismissedKeysSync,
  isNotificationReadsSqlMissing,
  NOTIFICATION_READS_SQL_WARNING,
  __resetNotificationReadServiceForTests,
} from '../services/notificationReadService';
import { filterOrdersForPreparer } from '../services/orderPickingLogic';
import type { Depot, DepotHolder, MaterialOrder, Product, Role, User } from '../types';

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

describe('Prompt v58 — Notifications lues par utilisateur, commandes annulées & préparateurs limités à leur dépôt (5.16.0 / schéma 2.10.0)', () => {
  const depots: Depot[] = [
    { id: 'dep-a', name: 'Dépôt A', is_active: true },
    { id: 'dep-b', name: 'Dépôt B', is_active: true },
  ];

  const roles: Role[] = [
    { id: 0, name: 'Super Admin', permissions: ['*'] },
    { id: 1, name: 'Admin', permissions: ['*'] },
    { id: 2, name: 'Magasinier', permissions: ['perm_prepare_orders', 'perm_menu_order_prep'] },
    { id: 4, name: 'Opérateur', permissions: ['perm_create_order'] },
  ];

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    __resetNotificationReadServiceForTests();
  });

  it('0. aligne les versions (app 5.16.0, schéma 2.10.0, Android versionCode 12)', () => {
    expect(APP_VERSION).toBe('5.16.1');
    expect(EXPECTED_SCHEMA_VERSION).toBe('2.10.0');

    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    const desktopPkg = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'desktop/package.json'), 'utf8')
    );
    const androidVer = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'android/version-code.json'), 'utf8')
    );
    expect(pkg.version).toBe('5.16.1');
    expect(desktopPkg.version).toBe('5.16.1');
    expect(androidVer.versionCode).toBeGreaterThanOrEqual(12);
  });

  describe('1. buildNotificationKey : clé stable par (type, id, status) et changement de statut', () => {
    it('génère une clé stable <TYPE>:<id>:<status> et change de clé quand le statut change', () => {
      const kPending = buildNotificationKey('ORDER_TO_PREPARE', 'ord_123', 'PENDING');
      const kPendingObj = buildNotificationKey({
        type: 'ORDER_TO_PREPARE',
        id: 'ord_123',
        status: 'PENDING',
      });
      expect(kPending).toBe('ORDER_TO_PREPARE:ord_123:PENDING');
      expect(kPendingObj).toBe(kPending);

      const kAssigned = buildNotificationKey('ORDER_ASSIGNED_TO_ME', 'ord_123', 'PREPARING');
      const kReady = buildNotificationKey('ORDER_READY', 'ord_123', 'READY');
      const kCancelled = buildNotificationKey('ORDER_MODIFIED_OR_CANCELLED', 'ord_123', 'CANCELLED');
      const kStockOut = buildNotificationKey('STOCK_LOW_ALERT', 'prod_42', 'OUT');
      const kStockLow = buildNotificationKey('STOCK_LOW_ALERT', 'prod_42', 'LOW');

      expect(kAssigned).toBe('ORDER_ASSIGNED_TO_ME:ord_123:PREPARING');
      expect(kReady).toBe('ORDER_READY:ord_123:READY');
      expect(kCancelled).toBe('ORDER_MODIFIED_OR_CANCELLED:ord_123:CANCELLED');
      expect(kStockOut).toBe('STOCK_LOW_ALERT:prod_42:OUT');
      expect(kStockLow).toBe('STOCK_LOW_ALERT:prod_42:LOW');

      // Changer de statut produit une nouvelle clé -> la notification réapparaît pour la nouvelle étape
      expect(kReady).not.toBe(kPending);
      expect(kCancelled).not.toBe(kReady);
      expect(kStockOut).not.toBe(kStockLow);
    });

    it('applique la table shouldAutoDismissOnCardClick exactement selon le type/statut', () => {
      // Ne disparaissent PAS au clic sur la carte (tant que le statut ne change pas) :
      expect(shouldAutoDismissOnCardClick('WAITING_APPROVAL')).toBe(false);
      expect(shouldAutoDismissOnCardClick('PENDING')).toBe(false);
      expect(shouldAutoDismissOnCardClick('PREPARING')).toBe(false);
      expect(shouldAutoDismissOnCardClick('READY')).toBe(false);
      expect(shouldAutoDismissOnCardClick('ORDER_TO_PREPARE')).toBe(false);
      expect(shouldAutoDismissOnCardClick('ORDER_ASSIGNED_TO_ME')).toBe(false);
      expect(shouldAutoDismissOnCardClick('ORDER_READY')).toBe(false);
      expect(shouldAutoDismissOnCardClick('ORDER_PICKUP_DELEGATED')).toBe(false);

      // Disparaissent dès que l'utilisateur clique sur la carte :
      expect(shouldAutoDismissOnCardClick('CANCELLED')).toBe(true);
      expect(shouldAutoDismissOnCardClick('REJECTED')).toBe(true);
      expect(shouldAutoDismissOnCardClick('COLLECTED')).toBe(true);
      expect(shouldAutoDismissOnCardClick('ORDER_MODIFIED_OR_CANCELLED')).toBe(true);
      expect(shouldAutoDismissOnCardClick('ORDER_COLLECTED')).toBe(true);
      expect(shouldAutoDismissOnCardClick('TRANSFER_PENDING_RECEPTION')).toBe(true);
      expect(shouldAutoDismissOnCardClick('STOCK_LOW_ALERT')).toBe(true);
    });
  });

  describe('2. Exclusion de dismissedKeys, idempotence de dismissNotifications & isolation de clearMyDismissals', () => {
    const requester: User = {
      id: 'usr-req-1',
      name: 'Jean Demandeur',
      trigram: 'JDE',
      role_id: 4,
      pin: '',
      is_blocked: false,
    };

    const readyOrder: MaterialOrder = {
      id: 'ord_123',
      order_number: 'CMD-123',
      site_number: 'CH-01',
      requester_id: 'usr-req-1',
      requester_name: 'Jean Demandeur',
      status: 'READY',
      depot_id: 'dep-a',
      depot_name: 'Dépôt A',
      items: [],
      created_at: new Date().toISOString(),
    };

    const lowProduct: Product = {
      id: 'prod_99',
      reference: 'REF-99',
      brand: 'Bosch',
      model: 'Foret',
      sub_category_id: 1,
      unit_price: 10,
      quantity: 0,
      min_stock_alert: 5,
      store_name: 'Dépôt A',
    };

    const adminDepotA: User = {
      id: 'usr-admin-a',
      name: 'Admin A',
      trigram: 'ADA',
      role_id: 1,
      pin: '',
      is_blocked: false,
      allowed_depots: ['Dépôt A'],
    };

    it('exclut les clés présentes dans dismissedKeys de getTargetedOrderNotificationsForUser, computeTargetedBellBadgeCount, shouldEmitNotificationBeep et shouldShowNotificationBanner', () => {
      const notifKey = buildNotificationKey('ORDER_READY', 'ord_123', 'READY');
      const stockKey = buildNotificationKey('STOCK_LOW_ALERT', 'prod_99', 'OUT');

      // Avant lecture
      const beforeList = getTargetedOrderNotificationsForUser({
        user: requester,
        orders: [readyOrder],
        depots,
        roles,
      });
      expect(beforeList).toHaveLength(1);
      expect(beforeList[0].notifKey).toBe(notifKey);

      const beforeBadge = computeTargetedBellBadgeCount({
        user: adminDepotA,
        orders: [readyOrder],
        products: [lowProduct],
        depots,
        roles,
      });
      expect(beforeBadge).toBe(1); // lowProduct pour adminDepotA

      const dismissed = new Set<string>([notifKey, stockKey]);

      // Après lecture : exclu de la liste et du compteur
      const afterList = getTargetedOrderNotificationsForUser({
        user: requester,
        orders: [readyOrder],
        depots,
        roles,
        dismissedKeys: dismissed,
      });
      expect(afterList).toHaveLength(0);

      const afterBadge = computeTargetedBellBadgeCount({
        user: adminDepotA,
        orders: [readyOrder],
        products: [lowProduct],
        depots,
        roles,
        dismissedKeys: dismissed,
      });
      expect(afterBadge).toBe(0);

      // shouldEmitNotificationBeep et shouldShowNotificationBanner retournent false pour une clé lue
      expect(
        shouldEmitNotificationBeep({
          user: requester,
          eventType: 'ORDER_READY',
          order: readyOrder,
          depots,
          roles,
          notifKey,
          dismissedKeys: dismissed,
        })
      ).toBe(false);

      expect(
        shouldShowNotificationBanner({
          user: requester,
          eventType: 'ORDER_READY',
          order: readyOrder,
          depots,
          roles,
          notifKey,
          dismissedKeys: dismissed,
        })
      ).toBe(false);

      // Si la commande change de statut (ex. READY -> CANCELLED), la clé change -> la notification réapparaît
      const cancelledOrder: MaterialOrder = { ...readyOrder, status: 'CANCELLED' };
      const reappeared = getTargetedOrderNotificationsForUser({
        user: requester,
        orders: [cancelledOrder],
        depots,
        roles,
        dismissedKeys: dismissed,
      });
      expect(reappeared).toHaveLength(1);
      expect(reappeared[0].notifKey).toBe('ORDER_MODIFIED_OR_CANCELLED:ord_123:CANCELLED');
    });

    it("dismissNotifications n'appelle pas la RPC si toutes les clés sont déjà dans dismissedKeys", async () => {
      let rpcCallCount = 0;
      const fakeClient = {
        rpc: async (fn: string, args: { p_keys: string[] }) => {
          rpcCallCount += 1;
          expect(fn).toBe('dismiss_notifications');
          expect(args.p_keys).toEqual(['ORDER_READY:ord_123:READY']);
          return { data: 1, error: null };
        },
      };

      const key1 = 'ORDER_READY:ord_123:READY';
      await dismissNotifications([key1], { userId: 'usr-req-1', client: fakeClient });
      expect(rpcCallCount).toBe(1);

      // Deuxième appel avec la même clé déjà lue -> aucun appel RPC supplémentaire
      await dismissNotifications([key1], { userId: 'usr-req-1', client: fakeClient });
      expect(rpcCallCount).toBe(1);
    });

    it("clearMyDismissals n'efface que le localStorage de l'utilisateur connecté", async () => {
      const fakeClient = {
        rpc: async () => ({ data: null, error: null }),
      };

      await dismissNotifications(['ORDER_READY:ord_1:READY'], {
        userId: 'user-alice',
        client: fakeClient,
      });
      await dismissNotifications(['ORDER_READY:ord_2:READY'], {
        userId: 'user-bob',
        client: fakeClient,
      });

      expect(getDismissedKeysSync('user-alice').has('ORDER_READY:ord_1:READY')).toBe(true);
      expect(getDismissedKeysSync('user-bob').has('ORDER_READY:ord_2:READY')).toBe(true);

      await clearMyDismissals({ userId: 'user-alice', client: fakeClient });

      expect(getDismissedKeysSync('user-alice').size).toBe(0);
      expect(getDismissedKeysSync('user-bob').has('ORDER_READY:ord_2:READY')).toBe(true);
      expect(localStorage.getItem('tot_notif_dismissed_v1_user-bob')).toContain(
        'ORDER_READY:ord_2:READY'
      );
    });
  });

  describe('3. Commande CANCELLED / REJECTED : destinataires, carte dédiée XCircle, lecture et expiration à 7 jours', () => {
    const requester: User = {
      id: 'usr-req',
      name: 'Demandeur',
      trigram: 'DEM',
      role_id: 4,
      pin: '',
      is_blocked: false,
    };
    const assignedPreparer: User = {
      id: 'usr-prep-assigned',
      name: 'Préparateur Assigné',
      trigram: 'PAS',
      role_id: 2,
      pin: '',
      is_blocked: false,
      is_preparer: true,
      allowed_depots: ['Dépôt A'],
    };
    const otherPreparer: User = {
      id: 'usr-prep-other',
      name: 'Autre Préparateur',
      trigram: 'APR',
      role_id: 2,
      pin: '',
      is_blocked: false,
      is_preparer: true,
      allowed_depots: ['Dépôt A'],
    };
    const adminUser: User = {
      id: 'usr-admin',
      name: 'Admin',
      trigram: 'ADM',
      role_id: 0,
      pin: '',
      is_blocked: false,
    };

    const cancelledOrder: MaterialOrder = {
      id: 'ord_cancel_1',
      order_number: 'CMD-2026-099',
      site_number: 'CH-99',
      requester_id: 'usr-req',
      requester_name: 'Demandeur',
      preparer_id: 'usr-prep-assigned',
      preparer_name: 'Préparateur Assigné',
      status: 'CANCELLED',
      depot_id: 'dep-a',
      depot_name: 'Dépôt A',
      cancelled_by: 'Chef Marc',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: 'Chantier reporté',
      items: [],
      created_at: new Date().toISOString(),
    };

    const rejectedOrder: MaterialOrder = {
      ...cancelledOrder,
      id: 'ord_reject_1',
      order_number: 'CMD-2026-100',
      status: 'REJECTED',
      rejected_by: 'Directeur Paul',
      rejected_at: new Date().toISOString(),
      rejection_reason: 'Budget dépassé',
    };

    it('cible uniquement le demandeur et le préparateur assigné (pas les autres préparateurs ni les admins non concernés)', () => {
      expect(
        isUserRecipientForOrderEvent({
          user: requester,
          eventType: 'ORDER_MODIFIED_OR_CANCELLED',
          order: cancelledOrder,
          depots,
          roles,
        })
      ).toBe(true);

      expect(
        isUserRecipientForOrderEvent({
          user: assignedPreparer,
          eventType: 'ORDER_MODIFIED_OR_CANCELLED',
          order: cancelledOrder,
          depots,
          roles,
        })
      ).toBe(true);

      expect(
        isUserRecipientForOrderEvent({
          user: otherPreparer,
          eventType: 'ORDER_MODIFIED_OR_CANCELLED',
          order: cancelledOrder,
          depots,
          roles,
        })
      ).toBe(false);

      expect(
        isUserRecipientForOrderEvent({
          user: adminUser,
          eventType: 'ORDER_MODIFIED_OR_CANCELLED',
          order: cancelledOrder,
          depots,
          roles,
        })
      ).toBe(false);
    });

    it('fournit une carte dédiée XCircle avec motif et auteur pour CANCELLED et REJECTED (jamais « Commande prête au magasin ! »)', () => {
      const [cancelNotif] = getTargetedOrderNotificationsForUser({
        user: requester,
        orders: [cancelledOrder],
        depots,
        roles,
      });
      expect(cancelNotif).toBeDefined();
      const cancelCard = getNotificationCardDescriptor(cancelNotif, 'fr');
      expect(cancelCard.iconName).toBe('XCircle');
      expect(cancelCard.colorScheme).toBe('rose');
      expect(cancelCard.title).toContain('Commande annulée');
      expect(cancelCard.title).not.toContain('Commande prête');
      expect(cancelCard.reason).toBe('Chantier reporté');
      expect(cancelCard.author).toBe('Chef Marc');
      expect(cancelCard.autoDismissOnOpen).toBe(true);

      const [rejectNotif] = getTargetedOrderNotificationsForUser({
        user: requester,
        orders: [rejectedOrder],
        depots,
        roles,
      });
      expect(rejectNotif).toBeDefined();
      const rejectCard = getNotificationCardDescriptor(rejectNotif, 'fr');
      expect(rejectCard.iconName).toBe('XCircle');
      expect(rejectCard.colorScheme).toBe('rose');
      expect(rejectCard.title).toContain('Commande refusée');
      expect(rejectCard.reason).toBe('Budget dépassé');
      expect(rejectCard.author).toBe('Directeur Paul');
      expect(rejectCard.autoDismissOnOpen).toBe(true);
    });

    it('disparaît après dismissNotifications et expire automatiquement au-delà de 7 jours', async () => {
      const key = buildNotificationKey('ORDER_MODIFIED_OR_CANCELLED', cancelledOrder.id, 'CANCELLED');
      const dismissed = await dismissNotifications([key], requester.id);

      const afterDismiss = getTargetedOrderNotificationsForUser({
        user: requester,
        orders: [cancelledOrder],
        depots,
        roles,
        dismissedKeys: dismissed,
      });
      expect(afterDismiss).toHaveLength(0);

      // Commande annulée il y a 8 jours -> expirée automatiquement même sans dismiss
      const eightDaysAgoIso = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const expiredCancelledOrder: MaterialOrder = {
        ...cancelledOrder,
        id: 'ord_cancel_old',
        cancelled_at: eightDaysAgoIso,
        updated_at: eightDaysAgoIso,
      };
      expect(isOrderNotificationExpired(expiredCancelledOrder)).toBe(true);

      const listWithExpired = getTargetedOrderNotificationsForUser({
        user: requester,
        orders: [expiredCancelledOrder],
        depots,
        roles,
      });
      expect(listWithExpired).toHaveLength(0);
    });
  });

  describe('4, 5 & 6. Règle stricte des dépôts pour un préparateur (isUserAuthorizedPreparerForOrder, filterOrdersForPreparer, shouldWarnPreparerWithoutDepot)', () => {
    const prepNoDepot: User = {
      id: 'prep-none',
      name: 'Prep Sans Dépôt',
      trigram: 'PSD',
      role_id: 2,
      pin: '',
      is_blocked: false,
      is_preparer: true,
      allowed_depots: [],
    };

    const prepDepotA: User = {
      id: 'prep-a',
      name: 'Prep Dépôt A',
      trigram: 'PDA',
      role_id: 2,
      pin: '',
      is_blocked: false,
      is_preparer: true,
      allowed_depots: ['Dépôt A'],
    };

    const prepWildcard: User = {
      id: 'prep-star',
      name: 'Prep Tous Dépôts',
      trigram: 'PTD',
      role_id: 2,
      pin: '',
      is_blocked: false,
      is_preparer: true,
      allowed_depots: ['*'],
    };

    const prepViaHolderOnly: User = {
      id: 'prep-holder-a',
      name: 'Prep Holder Dépôt A',
      trigram: 'PHA',
      role_id: 2,
      pin: '',
      is_blocked: false,
      is_preparer: true,
      allowed_depots: undefined,
    };

    const adminRole0: User = {
      id: 'admin-0',
      name: 'Super Admin',
      trigram: 'SAD',
      role_id: 0,
      pin: '',
      is_blocked: false,
      allowed_depots: undefined,
    };

    const depotHolders: DepotHolder[] = [
      {
        depot_id: 'dep-a',
        user_id: 'prep-holder-a',
        can_send: true,
        can_receive: true,
      },
    ];

    const orderDepotA: MaterialOrder = {
      id: 'ord-a',
      order_number: 'CMD-A',
      site_number: 'CH-1',
      requester_id: 'req-1',
      requester_name: 'Req 1',
      status: 'PENDING',
      depot_id: 'dep-a',
      depot_name: 'Dépôt A',
      items: [],
      created_at: new Date().toISOString(),
    };

    const orderDepotB: MaterialOrder = {
      id: 'ord-b',
      order_number: 'CMD-B',
      site_number: 'CH-2',
      requester_id: 'req-1',
      requester_name: 'Req 1',
      status: 'PENDING',
      depot_id: 'dep-b',
      depot_name: 'Dépôt B',
      items: [],
      created_at: new Date().toISOString(),
    };

    const orderWithoutDepot: MaterialOrder = {
      id: 'ord-nodepot',
      order_number: 'CMD-NODEPOT',
      site_number: 'CH-3',
      requester_id: 'req-1',
      requester_name: 'Req 1',
      status: 'PENDING',
      items: [],
      created_at: new Date().toISOString(),
    };

    const orderAssignedToPrepNoDepot: MaterialOrder = {
      ...orderDepotB,
      id: 'ord-assigned-none',
      order_number: 'CMD-ASSIGNED',
      status: 'PREPARING',
      preparer_id: 'prep-none',
      preparer_name: 'Prep Sans Dépôt',
    };

    const orderAssignedToPrepAOnDepotB: MaterialOrder = {
      ...orderDepotB,
      id: 'ord-assigned-a-on-b',
      order_number: 'CMD-ASSIGNED-B',
      status: 'PREPARING',
      preparer_id: 'prep-a',
      preparer_name: 'Prep Dépôt A',
    };

    it('4. vérifie isUserAuthorizedPreparerForOrder pour tous les cas de figure', () => {
      // Préparateur sans dépôt -> false sur Dépôt A, Dépôt B et commande sans dépôt ; true uniquement si preparer_id == user.id
      expect(
        isUserAuthorizedPreparerForOrder({
          user: prepNoDepot,
          order: orderDepotA,
          depots,
          depotHolders,
          roles,
        })
      ).toBe(false);
      expect(
        isUserAuthorizedPreparerForOrder({
          user: prepNoDepot,
          order: orderWithoutDepot,
          depots,
          depotHolders,
          roles,
        })
      ).toBe(false);
      expect(
        isUserAuthorizedPreparerForOrder({
          user: prepNoDepot,
          order: orderAssignedToPrepNoDepot,
          depots,
          depotHolders,
          roles,
        })
      ).toBe(true);

      // Préparateur Dépôt A -> true sur Dépôt A, false sur Dépôt B, true sur commande sans dépôt, true sur commande où preparer_id == user.id
      expect(
        isUserAuthorizedPreparerForOrder({
          user: prepDepotA,
          order: orderDepotA,
          depots,
          depotHolders,
          roles,
        })
      ).toBe(true);
      expect(
        isUserAuthorizedPreparerForOrder({
          user: prepDepotA,
          order: orderDepotB,
          depots,
          depotHolders,
          roles,
        })
      ).toBe(false);
      expect(
        isUserAuthorizedPreparerForOrder({
          user: prepDepotA,
          order: orderWithoutDepot,
          depots,
          depotHolders,
          roles,
        })
      ).toBe(true);
      expect(
        isUserAuthorizedPreparerForOrder({
          user: prepDepotA,
          order: orderAssignedToPrepAOnDepotB,
          depots,
          depotHolders,
          roles,
        })
      ).toBe(true);

      // Préparateur ['*'] -> true partout
      expect(
        isUserAuthorizedPreparerForOrder({
          user: prepWildcard,
          order: orderDepotA,
          depots,
          depotHolders,
          roles,
        })
      ).toBe(true);
      expect(
        isUserAuthorizedPreparerForOrder({
          user: prepWildcard,
          order: orderDepotB,
          depots,
          depotHolders,
          roles,
        })
      ).toBe(true);

      // Titulaire depotHolders sur Dépôt A (sans allowed_depots) -> true sur Dépôt A, false sur Dépôt B
      expect(
        isUserAuthorizedPreparerForOrder({
          user: prepViaHolderOnly,
          order: orderDepotA,
          depots,
          depotHolders,
          roles,
        })
      ).toBe(true);
      expect(
        isUserAuthorizedPreparerForOrder({
          user: prepViaHolderOnly,
          order: orderDepotB,
          depots,
          depotHolders,
          roles,
        })
      ).toBe(false);

      // Admin 0/1 -> true partout
      expect(
        isUserAuthorizedPreparerForOrder({
          user: adminRole0,
          order: orderDepotA,
          depots,
          depotHolders,
          roles,
        })
      ).toBe(true);
      expect(
        isUserAuthorizedPreparerForOrder({
          user: adminRole0,
          order: orderDepotB,
          depots,
          depotHolders,
          roles,
        })
      ).toBe(true);
    });

    it('5. vérifie filterOrdersForPreparer selon les dépôts du préparateur', () => {
      const allOrders = [
        orderDepotA,
        orderDepotB,
        orderWithoutDepot,
        orderAssignedToPrepNoDepot,
        orderAssignedToPrepAOnDepotB,
      ];

      // Préparateur sans dépôt -> uniquement les commandes où preparer_id == user.id
      const forNoDepot = filterOrdersForPreparer(allOrders, prepNoDepot, depots, depotHolders, roles);
      expect(forNoDepot.map((o) => o.id)).toEqual(['ord-assigned-none']);

      // Préparateur Dépôt A -> Dépôt A + sans dépôt + assignées à lui
      const forDepotA = filterOrdersForPreparer(allOrders, prepDepotA, depots, depotHolders, roles);
      expect(forDepotA.map((o) => o.id).sort()).toEqual(
        ['ord-a', 'ord-assigned-a-on-b', 'ord-nodepot'].sort()
      );

      // Admin 0/1 -> toutes les commandes à préparer / en cours
      const forAdmin = filterOrdersForPreparer(allOrders, adminRole0, depots, depotHolders, roles);
      expect(forAdmin).toHaveLength(allOrders.length);
    });

    it('6. vérifie shouldWarnPreparerWithoutDepot : true si préparateur non-admin sans dépôt ni depotHolders, false sinon', () => {
      expect(
        shouldWarnPreparerWithoutDepot({
          user: prepNoDepot,
          depotHolders,
          depots,
          roles,
        })
      ).toBe(true);

      expect(
        shouldWarnPreparerWithoutDepot({
          user: prepDepotA,
          depotHolders,
          depots,
          roles,
        })
      ).toBe(false);

      expect(
        shouldWarnPreparerWithoutDepot({
          user: prepWildcard,
          depotHolders,
          depots,
          roles,
        })
      ).toBe(false);

      expect(
        shouldWarnPreparerWithoutDepot({
          user: prepViaHolderOnly,
          depotHolders,
          depots,
          roles,
        })
      ).toBe(false);

      expect(
        shouldWarnPreparerWithoutDepot({
          user: adminRole0,
          depotHolders,
          depots,
          roles,
        })
      ).toBe(false);
    });
  });

  describe('7 & 8. Contrat SQL 20_notification_reads.sql et repli localStorage sans erreur quand la RPC est absente', () => {
    it('7. vérifie le contrat de core_notification_dismissals, dismiss_notifications et clear_my_dismissals (et le fichier 20_notification_reads.sql si présent)', async () => {
      const sql20Path = path.resolve(process.cwd(), 'supabase-client/20_notification_reads.sql');
      if (fs.existsSync(sql20Path)) {
        const sqlContent = fs.readFileSync(sql20Path, 'utf8');
        expect(sqlContent).toContain('core_notification_dismissals');
        expect(sqlContent).toContain('ENABLE ROW LEVEL SECURITY');
        expect(sqlContent).toContain('dismiss_notifications');
        expect(sqlContent).toContain('clear_my_dismissals');
      }

      // Test de la couche de service avec un mock Supabase simulant core_notification_dismissals + RPC
      const fakeDbRows = new Map<string, Set<string>>();
      const fakeClient = {
        from: (table: string) => {
          expect(table).toBe('core_notification_dismissals');
          return {
            select: () => ({
              limit: async () => ({
                data: Array.from(fakeDbRows.get('usr-1') ?? []).map((notif_key) => ({ notif_key })),
                error: null,
              }),
            }),
          };
        },
        rpc: async (fn: string, args?: Record<string, unknown>) => {
          if (fn === 'dismiss_notifications') {
            const keys = (args?.p_keys as string[]) ?? [];
            const set = fakeDbRows.get('usr-1') ?? new Set<string>();
            keys.forEach((k) => set.add(k));
            fakeDbRows.set('usr-1', set);
            return { data: keys.length, error: null };
          }
          if (fn === 'clear_my_dismissals') {
            fakeDbRows.set('usr-1', new Set<string>());
            return { data: null, error: null };
          }
          return { data: null, error: null };
        },
      };

      await dismissNotifications(['ORDER_READY:ord_1:READY', 'STOCK_LOW_ALERT:p1:OUT'], {
        userId: 'usr-1',
        client: fakeClient,
      });
      const loaded = await loadMyDismissedKeys({ userId: 'usr-1', client: fakeClient });
      expect(loaded.has('ORDER_READY:ord_1:READY')).toBe(true);
      expect(loaded.has('STOCK_LOW_ALERT:p1:OUT')).toBe(true);

      await clearMyDismissals({ userId: 'usr-1', client: fakeClient });
      const afterClear = await loadMyDismissedKeys({ userId: 'usr-1', client: fakeClient });
      expect(afterClear.size).toBe(0);
    });

    it('8. replie sur localStorage sans erreur quand la RPC ou la table est absente (PGRST202 / 42883 / 42P01) et active le diagnostic SQL 20', async () => {
      const fakeClientMissingSql20 = {
        from: () => ({
          select: () => ({
            limit: async () => ({
              data: null,
              error: {
                code: '42P01',
                message: 'relation "public.core_notification_dismissals" does not exist',
              },
            }),
          }),
        }),
        rpc: async () => ({
          data: null,
          error: {
            code: 'PGRST202',
            message:
              'Could not find the function public.dismiss_notifications(p_keys) in the schema cache',
          },
        }),
      };

      expect(isNotificationReadsSqlMissing()).toBe(false);

      const afterDismiss = await dismissNotifications(['ORDER_READY:ord_77:READY'], {
        userId: 'usr-offline',
        client: fakeClientMissingSql20,
      });
      expect(afterDismiss.has('ORDER_READY:ord_77:READY')).toBe(true);
      expect(isNotificationReadsSqlMissing()).toBe(true);
      expect(NOTIFICATION_READS_SQL_WARNING).toBe(
        'Notifications lues non synchronisées : exécutez le script SQL 20'
      );

      const loaded = await loadMyDismissedKeys({
        userId: 'usr-offline',
        client: fakeClientMissingSql20,
      });
      expect(loaded.has('ORDER_READY:ord_77:READY')).toBe(true);
    });
  });
});
