import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { SQL_STEPS } from '../../scripts/build-sql.mjs';
import { SQL_SCRIPT_13_TRANSFER_STOCK_BATCH } from '../constants/supabaseScripts';
import {
  APP_VERSION,
  EXPECTED_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from '../appVersion';
import {
  getActiveAllowedDepots,
  canUserTransferStock,
  getAvailableStockInDepot,
  isTransferMovement,
  getMovementSourceDepot,
  getMovementDestDepot,
  getMovementBatchId,
  groupMovementsByTransferBatch,
  commitStockTransferBatch,
} from '../services/stockMovementService';
import {
  getPendingSyncOperations,
  getRejectedSyncOperations,
  discardSyncOperation,
  getAllFromStore,
  clearStore,
} from '../services/offline/indexedDb';
import { processSyncQueue } from '../services/offline/syncEngine';
import { Depot, Product, StockLevel, StockMovement, User } from '../types';

const ROOT_DIR = path.resolve(__dirname, '../..');

async function createBootstrappedTransferDb(): Promise<{
  db: PGlite;
  UUID_SUPER_ADMIN: string;
  UUID_TRANSFER_USER: string;
  UUID_NO_PERM_USER: string;
}> {
  const db = new PGlite();
  const authStub = `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;
    CREATE SCHEMA IF NOT EXISTS auth;
    GRANT USAGE ON SCHEMA auth TO PUBLIC, anon, authenticated, service_role;
    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY,
      instance_id UUID,
      aud TEXT,
      role TEXT,
      email TEXT,
      encrypted_password TEXT,
      email_confirmed_at TIMESTAMPTZ DEFAULT now(),
      raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
      raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
    $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC, anon, authenticated, service_role;
  `;
  await db.exec(authStub);

  const scripts = [
    '00_complete_tot_stock_schema.sql',
    '09_core_prefixes.sql',
    '01_auth_link.sql',
    '01b_migrate_users_id_to_text.sql',
    '02_rls_hardening.sql',
    '03_rpc_stock_and_orders.sql',
    '04_mouvements_et_depots_vehicules.sql',
    '05_rpc_admin_users.sql',
    '06_install_additional_roles.sql',
    '08_print_jobs.sql',
    '11_suite_tables.sql',
    '12_user_preferences.sql',
    '13_transfer_stock_batch.sql',
    '14_mailing.sql',
    '15_search_orders_movements.sql',
    '07_app_compat.sql',
  ];
  for (const s of scripts) {
    await db.exec(fs.readFileSync(path.join(ROOT_DIR, 'supabase-client', s), 'utf8'));
  }

  // Re-run 13 and 07 to verify idempotency
  await db.exec(
    fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/13_transfer_stock_batch.sql'), 'utf8')
  );
  await db.exec(
    fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/07_app_compat.sql'), 'utf8')
  );

  const UUID_SUPER_ADMIN = '00000000-0000-4000-8000-000000000101';
  const UUID_TRANSFER_USER = '00000000-0000-4000-8000-000000000102';
  const UUID_NO_PERM_USER = '00000000-0000-4000-8000-000000000103';

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${UUID_SUPER_ADMIN}', 'admin@tot.local'),
      ('${UUID_TRANSFER_USER}', 'transfer@tot.local'),
      ('${UUID_NO_PERM_USER}', 'noperm@tot.local')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.core_roles (id, name, permissions) VALUES
      (90, 'Magasinier Transfert Uniquement', ARRAY['perm_stock_transfer']),
      (91, 'Lecteur Sans Droit Transfert', ARRAY['perm_prod_view'])
    ON CONFLICT (id) DO UPDATE SET permissions = EXCLUDED.permissions;

    INSERT INTO public.core_users (id, name, email, pin, role_id, is_blocked, auth_user_id) VALUES
      ('usr-admin', 'Admin TOT', 'admin@tot.local', '', 0, false, '${UUID_SUPER_ADMIN}'),
      ('usr-transfer', 'Agent Transfert', 'transfer@tot.local', '', 90, false, '${UUID_TRANSFER_USER}'),
      ('usr-noperm', 'Agent Lecteur', 'noperm@tot.local', '', 91, false, '${UUID_NO_PERM_USER}')
    ON CONFLICT (id) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id, role_id = EXCLUDED.role_id;

    UPDATE public.core_license_config
    SET plan_type = 'pro',
        max_depots = 50,
        signed_token = '{"plan":"pro","max_depots":50,"signature":"test-signature-pro-123456"}';

    INSERT INTO public.stk_depots (id, name, is_active) VALUES
      (1, 'Dépôt Central', true),
      (2, 'Dépôt Nord', true),
      (3, 'Camionnette 01', true)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = EXCLUDED.is_active;

    INSERT INTO public.stk_products (id, reference, brand, model, quantity, min_stock_alert, unit_price, store_name) VALUES
      ('prod-1', 'REF-TR-01', 'Bosch', 'Perceuse GSB 18V', 10, 2, 150, 'Dépôt Central'),
      ('prod-2', 'REF-TR-02', 'Makita', 'Meuleuse DGA504', 5, 1, 180, 'Dépôt Central'),
      ('prod-3', 'REF-TR-03', 'Hilti', 'Perforateur TE-30', 2, 1, 420, 'Dépôt Central')
    ON CONFLICT (id) DO UPDATE SET quantity = EXCLUDED.quantity, store_name = EXCLUDED.store_name;

    DELETE FROM public.stk_stock_levels WHERE product_id IN ('prod-1', 'prod-2', 'prod-3');
    INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, min_alert, rack_location) VALUES
      ('prod-1', 'Dépôt Central', 10, 2, 'A-01'),
      ('prod-1', 'Dépôt Nord', 3, 1, 'N-01'),
      ('prod-2', 'Dépôt Central', 5, 1, 'A-02'),
      ('prod-3', 'Dépôt Central', 2, 1, 'B-01');
  `);

  return {
    db,
    UUID_SUPER_ADMIN,
    UUID_TRANSFER_USER,
    UUID_NO_PERM_USER,
  };
}

describe('Prompt v49 — LOT 1 : SQL 13_transfer_stock_batch.sql, Schéma 2.4.1 & App 5.9.1', () => {
  it('déclare le script 13 dans SQL_STEPS (après 12 et avant 07), exporte SQL_SCRIPT_13_TRANSFER_STOCK_BATCH et aligne APP_VERSION=5.13.0 / EXPECTED_SCHEMA_VERSION=2.7.0', () => {
    expect(APP_VERSION).toBe('5.13.0');
    expect(EXPECTED_SCHEMA_VERSION).toBe('2.7.0');
    expect(MIN_SUPPORTED_SCHEMA_VERSION).toBe('1.0.0');

    const stepNumbers = SQL_STEPS.map((s: any) => String(s.step));
    const idx12 = stepNumbers.indexOf('12');
    const idx13 = stepNumbers.indexOf('13');
    const idx07 = stepNumbers.indexOf('07');
    expect(idx12).toBeGreaterThan(0);
    expect(idx13).toBe(idx12 + 1);
    expect(idx07).toBeGreaterThan(idx13);

    expect(SQL_SCRIPT_13_TRANSFER_STOCK_BATCH).toContain(
      'CREATE OR REPLACE FUNCTION public.transfer_stock_batch'
    );
    expect(SQL_SCRIPT_13_TRANSFER_STOCK_BATCH).toContain('perm_stock_transfer');
  });

  it(
    'SQL PGlite : lot de 2 articles OK, idempotence sur batch_id, tout-ou-rien sur manque de stock, permissions (perm_stock_transfer OK, sans droit refusé, non connecté refusé, anon refusé), même dépôt refusé, quantité 0 refusée, diagnostic_installation() 2.7.0',
    async () => {
      const { db, UUID_TRANSFER_USER, UUID_NO_PERM_USER } = await createBootstrappedTransferDb();

      // 1. Vérifier diagnostic_installation() -> 2.7.0 + transfer_stock_batch_rpc = 'OK'
      const diagRes = await db.query<{
        check_key: string;
        check_label: string;
        status: string;
        details: string;
      }>(`SELECT * FROM public.diagnostic_installation();`);
      const schemaRow = diagRes.rows.find((r) => r.check_key === 'app_compat');
      const transferRow = diagRes.rows.find((r) => r.check_key === 'transfer_stock_batch_rpc');
      expect(schemaRow?.status).toBe('OK');
      expect(schemaRow?.details).toContain('2.7.0');
      expect(transferRow?.status).toBe('OK');

      // 2. Lot de 2 articles par un utilisateur ayant uniquement perm_stock_transfer (rôle 90)
      const batchId1 = '11111111-2222-4333-8444-555555555501';
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_TRANSFER_USER}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
      `);
      const transfer1Res = await db.query<{ res: any }>(
        `SELECT public.transfer_stock_batch(
          $1::uuid,
          'Dépôt Central',
          'Dépôt Nord',
          $2::jsonb,
          'Réassort chantier Nord'
        ) AS res;`,
        [
          batchId1,
          JSON.stringify([
            { product_id: 'prod-1', quantity: 4, dest_rack: 'N-10' },
            { product_id: 'prod-2', quantity: 2, dest_rack: 'N-20' },
          ]),
        ]
      );
      await db.exec('COMMIT;');

      const payload1 = transfer1Res.rows[0].res;
      expect(payload1.success).toBe(true);
      expect(payload1.item_count).toBe(2);
      expect(payload1.total_pieces).toBe(6);

      // Vérifier les stocks par dépôt et la préservation de stk_products.store_name
      const levelsAfter1 = await db.query<{
        product_id: string;
        depot_name: string;
        quantity: number;
        rack_location: string;
      }>(
        `SELECT product_id, depot_name, quantity::int AS quantity, rack_location
         FROM public.stk_stock_levels
         WHERE product_id IN ('prod-1', 'prod-2')
         ORDER BY product_id, depot_name;`
      );
      expect(levelsAfter1.rows).toEqual([
        { product_id: 'prod-1', depot_name: 'Dépôt Central', quantity: 6, rack_location: 'A-01' },
        { product_id: 'prod-1', depot_name: 'Dépôt Nord', quantity: 7, rack_location: 'N-10' },
        { product_id: 'prod-2', depot_name: 'Dépôt Central', quantity: 3, rack_location: 'A-02' },
        { product_id: 'prod-2', depot_name: 'Dépôt Nord', quantity: 2, rack_location: 'N-20' },
      ]);

      const prodsAfter1 = await db.query<{ id: string; store_name: string; quantity: number }>(
        `SELECT id, store_name, quantity::int AS quantity FROM public.stk_products WHERE id IN ('prod-1', 'prod-2') ORDER BY id;`
      );
      // store_name reste 'Dépôt Central' et quantity = somme des dépôts (6+7=13, 3+2=5)
      expect(prodsAfter1.rows).toEqual([
        { id: 'prod-1', store_name: 'Dépôt Central', quantity: 13 },
        { id: 'prod-2', store_name: 'Dépôt Central', quantity: 5 },
      ]);

      // 3. Rejeu du même batch_id = aucun changement (idempotent)
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_TRANSFER_USER}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
      `);
      const replayRes = await db.query<{ res: any }>(
        `SELECT public.transfer_stock_batch(
          $1::uuid,
          'Dépôt Central',
          'Dépôt Nord',
          $2::jsonb,
          'Réassort chantier Nord'
        ) AS res;`,
        [
          batchId1,
          JSON.stringify([
            { product_id: 'prod-1', quantity: 4, dest_rack: 'N-10' },
            { product_id: 'prod-2', quantity: 2, dest_rack: 'N-20' },
          ]),
        ]
      );
      await db.exec('COMMIT;');
      expect(replayRes.rows[0].res.idempotent_replay).toBe(true);

      const movCountAfterReplay = await db.query<{ cnt: string }>(
        `SELECT count(*)::text AS cnt FROM public.stk_movements WHERE id LIKE '%' || $1 || '%';`,
        [batchId1]
      );
      expect(Number(movCountAfterReplay.rows[0].cnt)).toBe(2);

      // 4. Lot dont la 2e ligne manque de stock = AUCUNE ligne appliquée (atomicité tout-ou-rien)
      const batchIdInsufficient = '11111111-2222-4333-8444-555555555502';
      await expect(
        db.exec(`
          BEGIN;
          SET LOCAL ROLE authenticated;
          SELECT set_config('request.jwt.claim.sub', '${UUID_TRANSFER_USER}', true);
          SELECT set_config('request.jwt.claim.role', 'authenticated', true);
          SELECT public.transfer_stock_batch(
            '${batchIdInsufficient}'::uuid,
            'Dépôt Central',
            'Dépôt Nord',
            '[{"product_id":"prod-1","quantity":2},{"product_id":"prod-3","quantity":99}]'::jsonb,
            'Lot partiellement invalide'
          );
          COMMIT;
        `)
      ).rejects.toThrow(/Stock insuffisant/i);
      await db.exec('ROLLBACK;');

      // Vérifier que prod-1 est resté à 6 dans Dépôt Central et qu'aucun mouvement n'a été créé pour batchIdInsufficient
      const prod1LevelCheck = await db.query<{ quantity: number }>(
        `SELECT quantity::int AS quantity FROM public.stk_stock_levels WHERE product_id = 'prod-1' AND depot_name = 'Dépôt Central';`
      );
      expect(prod1LevelCheck.rows[0].quantity).toBe(6);

      const failedMovCheck = await db.query<{ cnt: string }>(
        `SELECT count(*)::text AS cnt FROM public.stk_movements WHERE id LIKE '%' || $1 || '%';`,
        [batchIdInsufficient]
      );
      expect(Number(failedMovCheck.rows[0].cnt)).toBe(0);

      // 5. Utilisateur sans droit (rôle 91 sans perm_stock_transfer) refusé
      await expect(
        db.exec(`
          BEGIN;
          SET LOCAL ROLE authenticated;
          SELECT set_config('request.jwt.claim.sub', '${UUID_NO_PERM_USER}', true);
          SELECT set_config('request.jwt.claim.role', 'authenticated', true);
          SELECT public.transfer_stock_batch(
            '11111111-2222-4333-8444-555555555503'::uuid,
            'Dépôt Central',
            'Dépôt Nord',
            '[{"product_id":"prod-1","quantity":1}]'::jsonb,
            'Test sans permission'
          );
          COMMIT;
        `)
      ).rejects.toThrow(/perm_stock_transfer/i);
      await db.exec('ROLLBACK;');

      // 6. Même dépôt source et destination refusé
      await expect(
        db.exec(`
          BEGIN;
          SET LOCAL ROLE authenticated;
          SELECT set_config('request.jwt.claim.sub', '${UUID_TRANSFER_USER}', true);
          SELECT set_config('request.jwt.claim.role', 'authenticated', true);
          SELECT public.transfer_stock_batch(
            '11111111-2222-4333-8444-555555555504'::uuid,
            'Dépôt Central',
            'Dépôt Central',
            '[{"product_id":"prod-1","quantity":1}]'::jsonb,
            'Même dépôt'
          );
          COMMIT;
        `)
      ).rejects.toThrow(/distinct/i);
      await db.exec('ROLLBACK;');

      // 7. Quantité 0 refusée
      await expect(
        db.exec(`
          BEGIN;
          SET LOCAL ROLE authenticated;
          SELECT set_config('request.jwt.claim.sub', '${UUID_TRANSFER_USER}', true);
          SELECT set_config('request.jwt.claim.role', 'authenticated', true);
          SELECT public.transfer_stock_batch(
            '11111111-2222-4333-8444-555555555505'::uuid,
            'Dépôt Central',
            'Dépôt Nord',
            '[{"product_id":"prod-1","quantity":0}]'::jsonb,
            'Quantité zéro'
          );
          COMMIT;
        `)
      ).rejects.toThrow(/quantité|quantity|supérieure|positive/i);
      await db.exec('ROLLBACK;');

      // 8. Non connecté (auth.uid() IS NULL) refusé
      await expect(
        db.exec(`
          BEGIN;
          SET LOCAL ROLE authenticated;
          SELECT set_config('request.jwt.claim.sub', '', true);
          SELECT set_config('request.jwt.claim.role', 'authenticated', true);
          SELECT public.transfer_stock_batch(
            '11111111-2222-4333-8444-555555555506'::uuid,
            'Dépôt Central',
            'Dépôt Nord',
            '[{"product_id":"prod-1","quantity":1}]'::jsonb,
            'Non connecté'
          );
          COMMIT;
        `)
      ).rejects.toThrow(/Authentication required/i);
      await db.exec('ROLLBACK;');

      // 9. Rôle anon refusé
      await expect(
        db.exec(`
          BEGIN;
          SET LOCAL ROLE anon;
          SELECT set_config('request.jwt.claim.sub', '${UUID_TRANSFER_USER}', true);
          SELECT set_config('request.jwt.claim.role', 'anon', true);
          SELECT public.transfer_stock_batch(
            '11111111-2222-4333-8444-555555555507'::uuid,
            'Dépôt Central',
            'Dépôt Nord',
            '[{"product_id":"prod-1","quantity":1}]'::jsonb,
            'Anon'
          );
          COMMIT;
        `)
      ).rejects.toThrow(/permission denied|anonymous access/i);
      await db.exec('ROLLBACK;');

      // 10. process_stock_movement(p_type => 'TRANSFER') accepte également perm_stock_transfer
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_TRANSFER_USER}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
        SELECT public.process_stock_movement(
          '11111111-2222-4333-8444-555555555508'::uuid,
          'prod-1',
          'Dépôt Central',
          'TRANSFER',
          1,
          'Transfert unitaire via process_stock_movement',
          NULL,
          'Logistique',
          'Camionnette 01',
          'V-01',
          '{}'::jsonb,
          'STOCK_DIRECT_MOVE'
        );
        COMMIT;
      `);
      const vehicleLevel = await db.query<{ quantity: number }>(
        `SELECT quantity::int AS quantity FROM public.stk_stock_levels WHERE product_id = 'prod-1' AND depot_name = 'Camionnette 01';`
      );
      expect(vehicleLevel.rows[0].quantity).toBe(1);
    },
    60000
  );
});

describe('Prompt v49 — LOT 2 & LOT 3 : Visibilité, Transfert 1 et 3 articles, Validation, Rollback, File hors-ligne & Historique', () => {
  const sampleDepots: Depot[] = [
    { id: 1, name: 'Dépôt Central', is_active: true, type: 'FIXED' },
    { id: 2, name: 'Dépôt Nord', is_active: true, type: 'FIXED' },
    { id: 3, name: 'Dépôt Fermé', is_active: false, type: 'FIXED' },
    { id: 4, name: 'Camionnette Est', is_active: true, type: 'VEHICLE' },
  ];

  const sampleProducts: Product[] = [
    {
      id: 'p1',
      reference: 'ART-001',
      brand: 'Bosch',
      model: 'Perceuse 18V',
      sub_category_id: 1,
      quantity: 12,
      min_stock_alert: 2,
      unit_price: 100,
      store_name: 'Dépôt Central',
      rack_location: 'A1',
    },
    {
      id: 'p2',
      reference: 'ART-002',
      brand: 'Makita',
      model: 'Visseuse Choc',
      sub_category_id: 1,
      quantity: 8,
      min_stock_alert: 2,
      unit_price: 120,
      store_name: 'Dépôt Central',
      rack_location: 'A2',
    },
    {
      id: 'p3',
      reference: 'ART-003',
      brand: 'Hilti',
      model: 'Laser Rotatif',
      sub_category_id: 1,
      quantity: 4,
      min_stock_alert: 1,
      unit_price: 350,
      store_name: 'Dépôt Central',
      rack_location: 'B1',
    },
  ];

  const sampleLevels: StockLevel[] = [
    { product_id: 'p1', depot_name: 'Dépôt Central', quantity: 10, min_alert: 2, rack_location: 'A1' },
    { product_id: 'p1', depot_name: 'Dépôt Nord', quantity: 2, min_alert: 1, rack_location: 'N1' },
    { product_id: 'p2', depot_name: 'Dépôt Central', quantity: 8, min_alert: 2, rack_location: 'A2' },
    { product_id: 'p3', depot_name: 'Dépôt Central', quantity: 4, min_alert: 1, rack_location: 'B1' },
  ];

  beforeEach(async () => {
    await clearStore('sync_queue');
    await clearStore('stock_movements');
  });

  it('filtre les dépôts fermés (is_active = false) et masque le bouton de transfert si sans permission ou < 2 dépôts actifs accessibles', () => {
    const userWithTransfer: User = {
      id: 'u1',
      name: 'Magasinier',
      trigram: 'MAG',
      pin: '',
      role_id: 2,
      is_blocked: false,
      allowed_depots: ['*'],
    };
    const activeDepots = getActiveAllowedDepots(userWithTransfer, sampleDepots);
    // 'Dépôt Fermé' (is_active: false) ne doit jamais être proposé
    expect(activeDepots.map((d) => d.name)).toEqual([
      'Dépôt Central',
      'Dépôt Nord',
      'Camionnette Est',
    ]);
    expect(activeDepots.some((d) => d.name === 'Dépôt Fermé')).toBe(false);

    // Utilisateur avec perm_stock_transfer et >= 2 dépôts actifs -> true
    expect(canUserTransferStock(userWithTransfer, sampleDepots, true)).toBe(true);

    // Utilisateur sans perm_stock_transfer (et non rôle 0/1) -> false
    expect(canUserTransferStock(userWithTransfer, sampleDepots, false)).toBe(false);

    // Utilisateur restreint à 1 seul dépôt actif -> false
    const singleDepotUser: User = {
      ...userWithTransfer,
      allowed_depots: ['Dépôt Central', 'Dépôt Fermé'],
    };
    expect(canUserTransferStock(singleDepotUser, sampleDepots, true)).toBe(false);

    // Stock disponible par dépôt
    expect(getAvailableStockInDepot(sampleProducts[0], 'Dépôt Central', sampleLevels)).toBe(10);
    expect(getAvailableStockInDepot('p1', 'Dépôt Nord', sampleLevels)).toBe(2);
    expect(getAvailableStockInDepot('p2', 'Dépôt Nord', sampleLevels)).toBe(0);
  });

  it('refuse même dépôt source/destination et quantité <= 0', async () => {
    await expect(
      commitStockTransferBatch({
        sourceDepot: 'Dépôt Central',
        destDepot: 'Dépôt Central',
        items: [{ productId: 'p1', quantity: 1 }],
      })
    ).rejects.toThrow(/différents/i);

    await expect(
      commitStockTransferBatch({
        sourceDepot: 'Dépôt Central',
        destDepot: 'Dépôt Nord',
        items: [{ productId: 'p1', quantity: 0 }],
      })
    ).rejects.toThrow(/supérieure à 0/i);
  });

  it('exécute un transfert de 1 article et un transfert de 3 articles en ligne via le client RPC', async () => {
    const rpcCalls: Array<{ fn: string; args: any }> = [];
    const fakeClient: any = {
      rpc: async (fn: string, args: any) => {
        rpcCalls.push({ fn, args });
        return {
          data: {
            status: 'applied',
            batch_id: args.p_batch_id,
            applied_count: args.p_items.length,
          },
          error: null,
        };
      },
    };

    // Transfert 1 article
    const res1 = await commitStockTransferBatch({
      client: fakeClient,
      isOnline: true,
      sourceDepot: 'Dépôt Central',
      destDepot: 'Dépôt Nord',
      items: [{ productId: 'p1', quantity: 3, destRack: 'N-01' }],
      reason: 'Transfert 1 article',
    });
    expect(res1.success).toBe(true);
    expect(res1.status).toBe('committed');
    expect(res1.rolledBack).toBe(false);

    // Transfert 3 articles
    const res3 = await commitStockTransferBatch({
      client: fakeClient,
      isOnline: true,
      sourceDepot: 'Dépôt Central',
      destDepot: 'Camionnette Est',
      items: [
        { productId: 'p1', quantity: 2, destRack: 'V-1' },
        { productId: 'p2', quantity: 4, destRack: 'V-2' },
        { productId: 'p3', quantity: 1, destRack: 'V-3' },
      ],
      reason: 'Chargement complet camionnette',
    });
    expect(res3.success).toBe(true);
    expect(res3.status).toBe('committed');
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[1].fn).toBe('send_stock_transfer');
    expect(rpcCalls[1].args.p_items).toHaveLength(3);
  });

  it('déclenche un rollback complet (rolledBack = true) et nettoie IndexedDB si le serveur refuse le lot', async () => {
    let rollbackCalled = false;
    const failingClient: any = {
      rpc: async () => ({
        data: null,
        error: {
          code: 'P0001',
          message: 'Stock insuffisant dans le dépôt "Dépôt Central" pour REF-002',
        },
      }),
    };

    const optimisticMov: StockMovement = {
      id: 'MOV-TRF-TEST-1',
      product_id: 'p1',
      product_ref: 'ART-001',
      type: 'TRANSFER',
      movement_type: 'OUT',
      quantity: 2,
      quantity_changed: 2,
      depot_name: 'Dépôt Central',
      dest_depot_name: 'Dépôt Nord',
      created_at: new Date().toISOString(),
    };

    const res = await commitStockTransferBatch({
      client: failingClient,
      isOnline: true,
      sourceDepot: 'Dépôt Central',
      destDepot: 'Dépôt Nord',
      items: [
        { productId: 'p1', quantity: 2 },
        { productId: 'p2', quantity: 99 },
      ],
      localMovements: [optimisticMov],
      rollbackLocalState: () => {
        rollbackCalled = true;
      },
      reason: 'Test échec serveur',
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe('rejected');
    expect(res.rolledBack).toBe(true);
    expect(rollbackCalled).toBe(true);
    expect(res.message).toContain('Stock insuffisant');

    const storedMovs = await getAllFromStore('stock_movements');
    expect(storedMovs).toHaveLength(0);
  });

  it('met le lot en file hors-ligne (RPC_STOCK_TRANSFER_BATCH) puis le rejoue à la reconnexion avec le même batch_id sans doublon, et marque rejected en cas de conflit serveur', async () => {
    const batchIdOffline = '22222222-3333-4444-8555-666666666601';

    // 1. Hors-ligne : mise en file d'attente
    const queuedRes = await commitStockTransferBatch({
      client: null,
      isOnline: false,
      batchId: batchIdOffline,
      sourceDepot: 'Dépôt Central',
      destDepot: 'Dépôt Nord',
      items: [
        { productId: 'p1', quantity: 2, destRack: 'N-1' },
        { productId: 'p2', quantity: 3, destRack: 'N-2' },
      ],
      reason: 'Transfert saisi hors-ligne',
    });

    expect(queuedRes.status).toBe('queued_offline');
    expect(queuedRes.batchId).toBe(batchIdOffline);

    const pendingBefore = await getPendingSyncOperations();
    expect(pendingBefore).toHaveLength(1);
    expect(pendingBefore[0].action).toBe('RPC_STOCK_TRANSFER_BATCH');
    expect(pendingBefore[0].payload.p_batch_id).toBe(batchIdOffline);

    // 2. Reconnexion : rejeu via processSyncQueue avec le même batch_id
    const replayedCalls: any[] = [];
    const onlineClient: any = {
      rpc: async (fn: string, args: any) => {
        replayedCalls.push({ fn, args });
        return { data: { status: 'applied', batch_id: args.p_batch_id }, error: null };
      },
    };

    const syncStats = await processSyncQueue(onlineClient);
    expect(syncStats.syncedCount).toBe(1);
    expect(replayedCalls).toHaveLength(1);
    expect(replayedCalls[0].fn).toBe('send_stock_transfer');
    expect(replayedCalls[0].args.p_batch_id).toBe(batchIdOffline);

    const pendingAfter = await getPendingSyncOperations();
    expect(pendingAfter).toHaveLength(0);

    // 3. Conflit au rejeu (stock devenu insuffisant sur le serveur) -> passe en 'rejected' puis nettoyage via discardSyncOperation
    const batchIdConflict = '22222222-3333-4444-8555-666666666602';
    const localConflictMov: StockMovement = {
      id: 'MOV-TRF-CONFLICT-1',
      product_id: 'p3',
      product_ref: 'ART-003',
      type: 'TRANSFER',
      movement_type: 'OUT',
      quantity: 4,
      quantity_changed: 4,
      depot_name: 'Dépôt Central',
      dest_depot_name: 'Dépôt Nord',
      created_at: new Date().toISOString(),
    };
    await commitStockTransferBatch({
      client: null,
      isOnline: false,
      batchId: batchIdConflict,
      sourceDepot: 'Dépôt Central',
      destDepot: 'Dépôt Nord',
      items: [{ productId: 'p3', quantity: 4 }],
      localMovements: [localConflictMov],
      reason: 'Conflit hors-ligne',
    });

    const conflictClient: any = {
      rpc: async () => ({
        data: null,
        error: { code: 'P0001', message: 'Stock insuffisant dans le dépôt Dépôt Central' },
      }),
    };

    const conflictStats = await processSyncQueue(conflictClient);
    expect(conflictStats.rejectedCount).toBe(1);

    const rejectedOps = await getRejectedSyncOperations();
    expect(rejectedOps).toHaveLength(1);
    expect(rejectedOps[0].last_error).toContain('Stock insuffisant');

    // L'utilisateur annule l'opération rejetée -> supprime aussi les mouvements optimistes locaux
    await discardSyncOperation(rejectedOps[0].id!);
    const remainingRejected = await getRejectedSyncOperations();
    expect(remainingRejected).toHaveLength(0);
    const remainingMovs = await getAllFromStore('stock_movements');
    expect(remainingMovs).toHaveLength(0);
  });

  it('regroupe les mouvements d’un même lot (groupMovementsByTransferBatch) et extrait correctement Dépôt A -> Dépôt B', () => {
    const sharedBatchId = '33333333-4444-4555-8666-777777777701';
    const movements: StockMovement[] = [
      {
        id: 'm1',
        product_id: 'p1',
        product_ref: 'ART-001',
        type: 'TRANSFER',
        movement_type: 'OUT',
        quantity: 3,
        quantity_changed: 3,
        user_name: 'Magasinier',
        depot_name: 'Dépôt Central',
        dest_depot_name: 'Dépôt Nord',
        batch_id: sharedBatchId,
        reason: 'Lot test',
        created_at: '2026-06-01T10:00:00.000Z',
      },
      {
        id: 'm2',
        product_id: 'p2',
        product_ref: 'ART-002',
        type: 'TRANSFER',
        movement_type: 'OUT',
        quantity: 5,
        quantity_changed: 5,
        user_name: 'Magasinier',
        depot_name: 'Dépôt Central',
        dest_depot_name: 'Dépôt Nord',
        batch_id: sharedBatchId,
        reason: 'Lot test',
        created_at: '2026-06-01T10:00:01.000Z',
      },
      {
        id: 'm3',
        product_id: 'p3',
        product_ref: 'ART-003',
        type: 'OUT',
        movement_type: 'OUT',
        quantity: 1,
        quantity_changed: 1,
        user_name: 'Technicien',
        depot_name: 'Dépôt Central',
        created_at: '2026-06-01T09:00:00.000Z',
      },
    ];

    expect(isTransferMovement(movements[0])).toBe(true);
    expect(isTransferMovement(movements[2])).toBe(false);
    expect(getMovementSourceDepot(movements[0])).toBe('Dépôt Central');
    expect(getMovementDestDepot(movements[0])).toBe('Dépôt Nord');
    expect(getMovementBatchId(movements[0])).toBe(sharedBatchId);

    const groups = groupMovementsByTransferBatch(movements);
    expect(groups).toHaveLength(2);
    expect(groups[0].batchId).toBe(sharedBatchId);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].movements).toHaveLength(2);
    expect(groups[0].totalQuantity).toBe(8);
    expect(groups[0].sourceDepot).toBe('Dépôt Central');
    expect(groups[0].destDepot).toBe('Dépôt Nord');
    expect(groups[1].batchId).toBeNull();
    expect(groups[1].items).toHaveLength(1);
  });

  it('garantit que l’en-tête sticky du tableau Inventaire Bureau est opaque et que le conteneur de défilement n’a pas de padding haut (aucune ligne au-dessus de l’en-tête)', () => {
    const invContent = fs.readFileSync(
      path.join(ROOT_DIR, 'src/desktop/pages/DesktopInventoryPage.tsx'),
      'utf8'
    );
    expect(invContent).toContain(
      'className="flex-1 min-h-0 overflow-y-auto overflow-x-auto bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800"'
    );
    expect(invContent).toContain(
      '<thead className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800'
    );
    expect(invContent).not.toContain('dark:bg-slate-800/95');
  });
});
