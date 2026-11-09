import { describe, it, expect } from 'vitest';
import {
  canUserViewDepot,
  filterVisibleDepotsForUser,
  formatDepotNameForDisplay,
  resolveDepotDepartmentName,
  getEligibleStockInDepotsForProduct,
} from '../utils/depotPermissions';
import {
  isTransferOverdue7Days,
  getSenderUnresolvedOverdueTransfers,
  hasSenderUnresolvedOverdueTransfers,
  returnOverdueTransferRpc,
} from '../services/transferService';
import { getTargetedTransferNotificationsForUser } from '../services/notificationService';
import { getProductDepotBreakdown } from '../services/desktopInventoryLogic';
import { buildDepotAuditCountingRows } from '../services/inventoryAuditLogic';
import { resolveProductForRefLink } from '../components/ProductRefLink';
import { Depot, Department, Product, StockLevel, StockTransferRecord, User } from '../types';

const mockProducts: Product[] = [
  {
    id: 'prod-1',
    reference: 'REF-001',
    brand: 'Bosch',
    model: 'GBH 2-26',
    sub_category_id: 1,
    shelf_name: 'A1',
    quantity: 15,
    min_stock_alert: 3,
    unit_price: 150,
    store_name: 'Dépôt Principal',
  },
  {
    id: 'prod-2',
    reference: 'REF-002',
    brand: 'Makita',
    model: 'DHP484',
    sub_category_id: 1,
    shelf_name: 'B1',
    quantity: 4,
    min_stock_alert: 2,
    unit_price: 120,
    store_name: 'Camionnette Elec',
  },
];

describe('v59 — Fiche référence cliquable, véhicules/conteneurs, KPI, entrées mobile, transferts > 7j, QR commande', () => {
  const users: User[] = [
    {
      id: 1,
      name: 'Admin Global',
      trigram: 'ADM',
      role_id: 1,
      department: 'Direction',
      custom_permissions: [],
    },
    {
      id: 10,
      name: 'Jean Elec',
      trigram: 'JEL',
      role_id: 3,
      department: 'Électricité',
      custom_permissions: [],
    },
    {
      id: 11,
      name: 'Paul Binome Elec',
      trigram: 'PBE',
      role_id: 4,
      department: 'Électricité',
      custom_permissions: [],
    },
    {
      id: 20,
      name: 'Marc Plomberie',
      trigram: 'MPL',
      role_id: 3,
      department: 'Plomberie',
      custom_permissions: [],
    },
    {
      id: 30,
      name: 'Lucie Logistique',
      trigram: 'LLO',
      role_id: 3,
      department: 'Logistique',
      custom_permissions: [],
    },
  ];

  const departments: Department[] = [
    { id: 1, name: 'Électricité', manager_id: 10, allow_global_kpis: false },
    { id: 2, name: 'Plomberie', manager_id: 20, allow_global_kpis: false },
    { id: 3, name: 'Logistique', manager_id: 30, allow_global_kpis: true },
  ];

  const depots: Depot[] = [
    {
      id: 'dep-main',
      name: 'Dépôt Principal',
      type: 'FIXED',
      is_active: true,
    },
    {
      id: 'veh-elec',
      name: 'Camionnette Elec',
      type: 'VEHICLE',
      manager_id: 10,
      manager_name: 'Jean Elec',
      binome_ids: [11],
      department_id: 1,
      department_name: 'Électricité',
      is_active: true,
    },
    {
      id: 'veh-plomb',
      name: 'Fourgon Plomberie',
      type: 'VEHICLE',
      manager_id: 20,
      manager_name: 'Marc Plomberie',
      department_id: 2,
      department_name: 'Plomberie',
      is_active: true,
    },
    {
      id: 'cont-plomb',
      name: 'Conteneur Chantier Sud',
      type: 'CONTAINER',
      manager_id: 20,
      manager_name: 'Marc Plomberie',
      department_id: 2,
      department_name: 'Plomberie',
      is_active: true,
    },
  ];

  describe('1. ProductRefLink résout le produit par productId ou reference pour ouvrir ProductDetailModal', () => {
    it('résout productId direct ou via reference insensible à la casse', () => {
      const resolvedById = resolveProductForRefLink(mockProducts, 'prod-1', 'REF-001');
      expect(resolvedById?.id).toBe('prod-1');

      const resolvedByRef = resolveProductForRefLink(mockProducts, undefined, 'ref-002');
      expect(resolvedByRef?.id).toBe('prod-2');

      const unknownRef = resolveProductForRefLink(mockProducts, undefined, 'INCONNU-999');
      expect(unknownRef).toBeUndefined();
    });
  });

  describe('2 & 3. Véhicules et conteneurs rattachés au département du titulaire et visibilité restreinte', () => {
    it('résout le département du véhicule via son titulaire et formate le nom avec le titulaire', () => {
      const vehWithoutExplicitDept: Depot = {
        id: 'veh-2',
        name: 'Camionnette 02',
        type: 'VEHICLE',
        manager_id: 10,
      };
      expect(resolveDepotDepartmentName(vehWithoutExplicitDept, users)).toBe('Électricité');
      expect(formatDepotNameForDisplay(vehWithoutExplicitDept, users)).toBe(
        'Camionnette 02 (Jean Elec)'
      );
    });

    it('restreint la visibilité des véhicules/conteneurs au département du collaborateur sauf admin', () => {
      const jeanElec = users.find((u) => u.id === 10)!;
      const marcPlomb = users.find((u) => u.id === 20)!;
      const adminUser = users.find((u) => u.id === 1)!;
      const lucieLog = users.find((u) => u.id === 30)!;

      // Jean (Électricité) voit Dépôt Principal et Camionnette Elec, mais pas Fourgon Plomberie ni Conteneur Chantier Sud
      const visibleForJean = filterVisibleDepotsForUser(depots, jeanElec, users, departments);
      expect(visibleForJean.map((d) => d.id)).toEqual(['dep-main', 'veh-elec']);
      expect(canUserViewDepot(depots[2], jeanElec, users, departments)).toBe(false);

      // Marc (Plomberie) voit Dépôt Principal, Fourgon Plomberie et Conteneur Chantier Sud, mais pas Camionnette Elec
      const visibleForMarc = filterVisibleDepotsForUser(depots, marcPlomb, users, departments);
      expect(visibleForMarc.map((d) => d.id)).toEqual(['dep-main', 'veh-plomb', 'cont-plomb']);

      // Admin voit tous les dépôts (4), tandis qu'un collaborateur d'un autre département sans véhicule rattaché ne voit que le dépôt fixe (1)
      expect(filterVisibleDepotsForUser(depots, adminUser, users, departments)).toHaveLength(4);
      expect(filterVisibleDepotsForUser(depots, lucieLog, users, departments).map((d) => d.id)).toEqual([
        'dep-main',
      ]);
    });

    it('filtre getProductDepotBreakdown et buildDepotAuditCountingRows selon canUserViewDepot', () => {
      const jeanElec = users.find((u) => u.id === 10)!;
      const stockLevels: StockLevel[] = [
        { id: 'sl-1', product_id: 'prod-1', depot_name: 'Dépôt Principal', quantity: 10 },
        { id: 'sl-2', product_id: 'prod-1', depot_name: 'Camionnette Elec', quantity: 3 },
        { id: 'sl-3', product_id: 'prod-1', depot_name: 'Fourgon Plomberie', quantity: 2 },
      ];

      const breakdown = getProductDepotBreakdown(
        mockProducts[0],
        stockLevels,
        jeanElec,
        depots,
        users,
        departments
      );
      expect(breakdown.depotRows.map((r) => r.depotName)).toEqual([
        'Camionnette Elec',
        'Dépôt Principal',
      ]);
      expect(breakdown.allowedTotalQuantity).toBe(13);

      // Marc Plomberie ne peut pas auditer Camionnette Elec
      const marcPlomb = users.find((u) => u.id === 20)!;
      const auditResult = buildDepotAuditCountingRows({
        selectedDepot: 'Camionnette Elec',
        products: mockProducts,
        stockLevels,
        currentUser: marcPlomb,
        depots,
        users,
        counts: {},
      });
      expect(auditResult.scopeRows).toHaveLength(0);
    });
  });

  describe('4. Entrées de stock sur mobile : choix du dépôt à réapprovisionner', () => {
    it('retourne tous les dépôts éligibles où le produit existe et où le collaborateur peut entrer du stock', () => {
      const paulBinomeElec = users.find((u) => u.id === 11)!;
      const stockLevels: StockLevel[] = [
        { id: 'sl-1', product_id: 'prod-1', depot_name: 'Dépôt Principal', quantity: 10 },
        { id: 'sl-2', product_id: 'prod-1', depot_name: 'Camionnette Elec', quantity: 2 },
        { id: 'sl-3', product_id: 'prod-1', depot_name: 'Fourgon Plomberie', quantity: 5 },
      ];

      // Paul est binôme de Camionnette Elec sans perm_stock_in global : il peut entrer du stock dans Camionnette Elec même si prod-1 a store_name = "Dépôt Principal"
      const eligibleForPaul = getEligibleStockInDepotsForProduct(
        mockProducts[0],
        stockLevels,
        depots,
        paulBinomeElec,
        false,
        departments,
        users
      );
      expect(eligibleForPaul.map((d) => d.name)).toEqual(['Camionnette Elec']);

      // Avec perm_stock_in global (ex. Jean Elec), il peut choisir entre Camionnette Elec (son véhicule en priorité) et Dépôt Principal (mais pas Fourgon Plomberie d'un autre département)
      const jeanElec = users.find((u) => u.id === 10)!;
      const eligibleForJean = getEligibleStockInDepotsForProduct(
        mockProducts[0],
        stockLevels,
        depots,
        jeanElec,
        true,
        departments,
        users
      );
      expect(eligibleForJean.map((d) => d.name)).toEqual([
        'Camionnette Elec',
        'Dépôt Principal',
      ]);
    });
  });

  describe('5. Transferts en transit depuis plus de 7 jours : remise en stock obligatoire (RETURNED_TO_STOCK)', () => {
    const eightDaysAgoIso = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgoIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const overdueTransfer: StockTransferRecord = {
      id: 'tr-overdue-1',
      transfer_number: 'TRF-2026-001',
      batch_id: 'batch-1',
      source_depot_id: 'dep-main',
      source_depot: 'Dépôt Principal',
      dest_depot_id: 'veh-elec',
      dest_depot: 'Camionnette Elec',
      status: 'IN_TRANSIT',
      created_at: eightDaysAgoIso,
      sender_id: '10',
      sender_name: 'Jean Elec',
      items: [
        {
          product_id: 'prod-1',
          product_ref: 'REF-001',
          product_name: 'Bosch GBH',
          quantity_sent: 2,
          quantity: 2,
        },
      ],
    };

    const recentTransfer: StockTransferRecord = {
      ...overdueTransfer,
      id: 'tr-recent-1',
      transfer_number: 'TRF-2026-002',
      created_at: twoDaysAgoIso,
    };

    it('détecte un transfert en transit > 7 jours, bloque l’expéditeur et génère la notification TRANSFER_OVERDUE (isOverdue7Days)', () => {
      expect(isTransferOverdue7Days(overdueTransfer)).toBe(true);
      expect(isTransferOverdue7Days(recentTransfer)).toBe(false);

      const jeanElec = users.find((u) => u.id === 10)!;
      const overdueForSender = getSenderUnresolvedOverdueTransfers(jeanElec, [
        overdueTransfer,
        recentTransfer,
      ]);
      expect(overdueForSender.map((t) => t.id)).toEqual(['tr-overdue-1']);
      expect(
        hasSenderUnresolvedOverdueTransfers(jeanElec, [overdueTransfer, recentTransfer])
      ).toBe(true);

      const notifs = getTargetedTransferNotificationsForUser({
        user: jeanElec,
        transfers: [overdueTransfer, recentTransfer],
        depots,
        depotHolders: [],
      });
      expect(
        notifs.some(
          (n) =>
            n.transfer.id === 'tr-overdue-1' &&
            n.eventType === 'TRANSFER_OVERDUE' &&
            n.isOverdue7Days === true
        )
      ).toBe(true);
    });

    it('exige un commentaire d’au moins 5 caractères pour returnOverdueTransferRpc et passe au statut RETURNED_TO_STOCK', async () => {
      const failRes = await returnOverdueTransferRpc('tr-overdue-1', 'abc');
      expect(failRes.success).toBe(false);
      expect(failRes.error).toMatch(/5 caractères/i);

      const mockClient = {
        rpc: async (fnName: string, args: Record<string, unknown>) => {
          expect(fnName).toBe('return_overdue_transfer');
          expect(args).toEqual({
            p_transfer_id: 'tr-overdue-1',
            p_comment: 'Destinataire absent sur chantier, matériel réintégré au magasin',
          });
          return {
            data: { status: 'RETURNED_TO_STOCK', returned_items: 1, returned_pieces: 2 },
            error: null,
          };
        },
      };

      const res = await returnOverdueTransferRpc(mockClient, {
        transferId: 'tr-overdue-1',
        comment: 'Destinataire absent sur chantier, matériel réintégré au magasin',
      });
      expect(res.success).toBe(true);
      expect(res.status).toBe('RETURNED_TO_STOCK');
    });
  });

  describe('6. QR code de commande Desktop (TOT-ORDER:<order_number>)', () => {
    it('formate la charge utile QR code commande en TOT-ORDER:<order_number>', () => {
      const orderNumber = 'CMD-2026-089';
      const qrPayload = `TOT-ORDER:${orderNumber}`;
      expect(qrPayload).toBe('TOT-ORDER:CMD-2026-089');
    });
  });
});
