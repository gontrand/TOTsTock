import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  enforceSignedLicenseQuotasSync,
  verifyAndApplySignedLicenseQuotas,
  createDefaultFreeLicense,
} from '../services/licenseService';
import {
  LICENSE_SIGNING_KEYS,
  CURRENT_KEY_ID,
} from '../services/licenseTokenService';
import { pushMovementToSupabase, transitionOrderStatusSupabase } from '../services/clientSupabase';
import { processSyncQueue, performIncrementalSync } from '../services/offline/syncEngine';
import {
  clearStore,
  enqueueSyncOperation,
  getAllFromStore,
  getByIdFromStore,
  hydrateAllFromIndexedDb,
  putToStore,
  replaceStoreContents,
  setSyncMetadata,
  ALL_STORE_NAMES,
} from '../services/offline/indexedDb';
import type { LicenseInfo, SignedLicenseToken, Product, MaterialOrder } from '../types';

const rootDir = process.cwd();

const AUTH_STUB_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  email_confirmed_at TIMESTAMPTZ DEFAULT now(),
  confirmed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
$$;

GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC, anon, authenticated, service_role;
`;

function readClientScript(filename: string): string {
  return fs.readFileSync(path.join(rootDir, 'supabase-client', filename), 'utf8');
}

describe('Hardening v38 — 4. Licences TOT, 2. Transactions de stock, 3. Synchronisation hors ligne', () => {
  const projectUrl = 'https://gdiyfvvjtidhraguuxjv.supabase.co';
  let originalPubKeyB64 = '';
  let testPrivateKey: CryptoKey;

  beforeAll(async () => {
    originalPubKeyB64 = LICENSE_SIGNING_KEYS[CURRENT_KEY_ID].publicKeyB64;
    const kp = (await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    testPrivateKey = kp.privateKey;
    const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
    LICENSE_SIGNING_KEYS[CURRENT_KEY_ID].publicKeyB64 = Buffer.from(spki).toString('base64');
  });

  afterAll(() => {
    LICENSE_SIGNING_KEYS[CURRENT_KEY_ID].publicKeyB64 = originalPubKeyB64;
    vi.restoreAllMocks();
  });

  async function signTestLicenseToken(opts?: {
    licenseKey?: string;
    plan?: 'sta' | 'pro' | 'ent';
    modules?: ('stock' | 'outils' | 'formation' | 'rapports')[];
    maxDepots?: number;
    orgName?: string;
    clientUrl?: string;
    projectRef?: string;
  }): Promise<SignedLicenseToken> {
    const licenseKey = opts?.licenseKey || 'TOT-STOCK-STA-11223344-55667788';
    const plan = opts?.plan || 'sta';
    const modules = opts?.modules || ['stock'];
    const maxDepots = opts?.maxDepots ?? 3;
    const orgName = opts?.orgName || 'Entreprise Test Quotas';
    const clientUrl = opts?.clientUrl || projectUrl;
    const projectRef = opts?.projectRef || 'gdiyfvvjtidhraguuxjv';
    const issuedAt = new Date().toISOString();
    const offlineUntil = new Date(Date.now() + 7 * 86400000).toISOString();
    const expiresAt = new Date(Date.now() + 365 * 86400000).toISOString();

    const payloadToSign = [
      CURRENT_KEY_ID,
      licenseKey,
      plan,
      modules.join(','),
      maxDepots,
      orgName,
      projectRef,
      issuedAt,
      offlineUntil,
      expiresAt,
    ].join('|');

    const sigBuf = await crypto.subtle.sign(
      { name: 'Ed25519' },
      testPrivateKey,
      new TextEncoder().encode(payloadToSign)
    );
    const signature = Buffer.from(sigBuf).toString('hex');

    const claims = {
      kid: CURRENT_KEY_ID,
      license_key: licenseKey,
      organization_name: orgName,
      plan,
      plan_type: plan,
      modules,
      max_depots: maxDepots,
      client_project_ref: projectRef,
      client_supabase_url: clientUrl,
      issued_at: issuedAt,
      expires_at: expiresAt,
      offline_until: offlineUntil,
      token_version: 5 as const,
    };
    const rawToken = `${Buffer.from(JSON.stringify(claims)).toString('base64')}.${signature}`;

    return {
      ...claims,
      signature,
      raw_token: rawToken,
    };
  }

  // ===========================================================================
  // 4. LICENCES TOT — Garantir que les quotas appliqués sont ceux de la licence signée
  // ===========================================================================
  describe('4. Licences TOT — Quotas strictement issus de la licence signée', () => {
    it('ignore toute falsification des champs de premier niveau (plan, max_depots, modules) et applique les quotas du signed_token', async () => {
      const signedStaToken = await signTestLicenseToken({
        plan: 'sta',
        maxDepots: 2,
        modules: ['stock'],
      });

      // Un attaquant modifie localStorage pour prétendre être en "ent" avec 99999 dépôts tout en gardant le jeton "sta"
      const tamperedLicense: LicenseInfo = {
        ...createDefaultFreeLicense(),
        id: 'tampered-1',
        license_key: signedStaToken.license_key,
        plan: 'ent',
        plan_type: 'ent',
        modules: ['stock', 'outils', 'formation', 'rapports'],
        max_depots: 99999,
        max_references: 99999,
        organization_name: 'Falsifié',
        is_active: true,
        signed_token: signedStaToken,
      };

      const syncEnforced = enforceSignedLicenseQuotasSync(tamperedLicense);
      expect(syncEnforced.plan).toBe('sta');
      expect(syncEnforced.max_depots).toBe(2);
      expect(syncEnforced.max_references).toBe(300); // plan_limits('sta').max_references = 300
      expect(syncEnforced.modules).toEqual(['stock']);

      const cryptoVerified = await verifyAndApplySignedLicenseQuotas(tamperedLicense, projectUrl);
      expect(cryptoVerified.valid).toBe(true);
      expect(cryptoVerified.license.plan).toBe('sta');
      expect(cryptoVerified.license.plan_type).toBe('sta');
      expect(cryptoVerified.license.max_depots).toBe(2);
      expect(cryptoVerified.license.max_references).toBe(300);
      expect(cryptoVerified.license.modules).toEqual(['stock']);
    });

    it('rétrograde immédiatement en forfait free (1 dépôt, 50 réf.) toute licence payante sans signed_token ou avec signature invalide', async () => {
      const unsignedPaidLicense: LicenseInfo = {
        ...createDefaultFreeLicense(),
        id: 'unsigned-ent',
        license_key: 'TOT-STOCK-ENT-FAKE',
        plan: 'ent',
        plan_type: 'ent',
        modules: ['stock', 'outils', 'formation', 'rapports'],
        max_depots: 99999,
        max_references: 99999,
        organization_name: 'Pirate Sans Jeton',
        is_active: true,
      };

      const syncDowngraded = enforceSignedLicenseQuotasSync(unsignedPaidLicense);
      expect(syncDowngraded.plan).toBe('free');
      expect(syncDowngraded.max_depots).toBe(1);
      expect(syncDowngraded.max_references).toBe(50);

      const asyncDowngraded = await verifyAndApplySignedLicenseQuotas(unsignedPaidLicense, projectUrl);
      expect(asyncDowngraded.valid).toBe(false);
      expect(asyncDowngraded.license.plan).toBe('free');
      expect(asyncDowngraded.license.plan_type).toBe('free');
      expect(asyncDowngraded.license.max_depots).toBe(1);
      expect(asyncDowngraded.license.max_references).toBe(50);

      // Jeton avec signature corrompue (revendications modifiées après signature)
      const validToken = await signTestLicenseToken({ plan: 'pro', maxDepots: 5 });
      const forgedToken: SignedLicenseToken = {
        ...validToken,
        plan: 'ent',
        plan_type: 'ent',
        max_depots: 99999,
      };
      const forgedCheck = await verifyAndApplySignedLicenseQuotas(
        {
          ...createDefaultFreeLicense(),
          plan: 'ent',
          plan_type: 'ent',
          max_depots: 99999,
          signed_token: forgedToken,
        },
        projectUrl
      );
      expect(forgedCheck.valid).toBe(false);
      expect(forgedCheck.license.plan).toBe('free');
      expect(forgedCheck.license.max_depots).toBe(1);
      expect(forgedCheck.license.max_references).toBe(50);
    });

    it('Edge Function syncLicenseHandler plafonne max_depots au quota de plan_limits(plan) et enregistre plan dans signed_token', () => {
      const syncHandlerSrc = fs.readFileSync(
        path.join(rootDir, 'supabase/functions/_shared/syncLicenseHandler.ts'),
        'utf8'
      );
      expect(syncHandlerSrc).toContain('Math.min(maxDepots, canonicalLimits.max_depots)');
      expect(syncHandlerSrc).toContain('plan: rawPlanExact');
      expect(syncHandlerSrc).toContain('max_depots: effectiveMaxDepots');
    });
  });

  // ===========================================================================
  // 2. TRANSACTIONS DE STOCK & TRIGGERS SQL (PGlite)
  // ===========================================================================
  describe('2. Transactions de stock & Quotas SQL (sans écritures de secours, TRANSFER et INVENTORY)', () => {
    let db: PGlite;
    const adminUuid = '11111111-1111-4111-8111-111111111111';

    beforeAll(async () => {
      db = new PGlite();
      await db.exec(AUTH_STUB_SQL);
      const scripts = [
        '00_complete_tot_stock_schema.sql',
        '01_auth_link.sql',
        '02_rls_hardening.sql',
        '03_rpc_stock_and_orders.sql',
        '04_mouvements_et_depots_vehicules.sql',
        '05_rpc_admin_users.sql',
        '06_install_additional_roles.sql',
        '08_print_jobs.sql',
        '07_app_compat.sql',
      ];
      for (const s of scripts) {
        await db.exec(readClientScript(s));
      }

      // Créer un utilisateur Super Admin lié à auth.uid() et le dépôt initial "Dépôt Central"
      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES ('${adminUuid}', 'admin@tot.local')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.users (id, name, email, pin, role_id, is_blocked, allowed_depots, is_preparer, auth_user_id)
        VALUES ('1', 'Super Admin', 'admin@tot.local', '', 0, false, ARRAY['*']::text[], true, '${adminUuid}')
        ON CONFLICT (id) DO UPDATE SET
          role_id = 0,
          allowed_depots = ARRAY['*']::text[],
          auth_user_id = '${adminUuid}';

        INSERT INTO public.depots (id, name, type)
        VALUES ('depot-central', 'Dépôt Central', 'MAGASIN')
        ON CONFLICT (id) DO NOTHING;

        SELECT set_config('request.jwt.claim.sub', '${adminUuid}', false);
        SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      `);
    }, 30000);

    it('vérifie qu’aucune écriture directe de secours sur movements, stock_movements, products ou license_config ne subsiste dans le code client', () => {
      const clientSupabaseSrc = fs.readFileSync(
        path.join(rootDir, 'src/services/clientSupabase.ts'),
        'utf8'
      );
      expect(clientSupabaseSrc).not.toContain("from('movements').insert");
      expect(clientSupabaseSrc).not.toContain("from('stock_movements').insert");
      expect(clientSupabaseSrc).not.toContain("from('material_orders')\n      .update");

      const licenseServiceSrc = fs.readFileSync(
        path.join(rootDir, 'src/services/licenseService.ts'),
        'utf8'
      );
      expect(licenseServiceSrc).not.toContain("from('license_config').upsert");
    });

    it('SQL : enforce_license_max_depots_quota et enforce_license_max_references_quota appliquent les quotas du signed_token et ignorent license_config non signé', async () => {
      // 1. Insérer une ligne license_config falsifiée (plan_type = 'ent', max_depots = 99999) SANS signed_token
      await db.exec(`
        DELETE FROM public.license_config;
        INSERT INTO public.license_config (id, license_key, plan_type, max_depots, signed_token)
        VALUES ('active_license', 'FAKE-ENT', 'ent', 99999, NULL);
      `);

      // Le dépôt initial "Dépôt Central" existe déjà (1 dépôt = limite du plan free).
      // L'ajout d'un 2e dépôt doit être bloqué car signed_token est NULL -> plan effectif = 'free' (max 1 dépôt)
      await expect(
        db.exec(`INSERT INTO public.depots (id, name, type) VALUES ('depot-pirate-2', 'Dépôt Pirate 2', 'MAGASIN');`)
      ).rejects.toThrow(/QUOTA_EXCEEDED.*limitée à 1/i);

      // 2. Insérer un signed_token JSON valide pour le plan 'sta' avec max_depots = 2, même si la colonne max_depots vaut 99
      const staToken = await signTestLicenseToken({ plan: 'sta', maxDepots: 2 });
      await db.query(
        `UPDATE public.license_config SET plan_type = 'ent', max_depots = 99, signed_token = $1 WHERE id = 'active_license';`,
        [JSON.stringify(staToken)]
      );

      // Le 2e dépôt est maintenant autorisé (quota signé = 2)
      await db.exec(`INSERT INTO public.depots (id, name, type) VALUES ('depot-cam-1', 'Camionnette 1', 'VEHICULE');`);

      // Le 3e dépôt doit être refusé car le signed_token 'sta' plafonne à 2 dépôts
      await expect(
        db.exec(`INSERT INTO public.depots (id, name, type) VALUES ('depot-cam-2', 'Camionnette 2', 'VEHICULE');`)
      ).rejects.toThrow(/QUOTA_EXCEEDED.*limitée à 2/i);
    });

    it('SQL : process_stock_movement exécute un transfert inter-dépôts (TRANSFER) atomique et conserve la quantité totale', async () => {
      // Créer un article avec 20 unités au Dépôt Central
      const prodRes = await db.query<{ id: string }>(`
        INSERT INTO public.products (id, reference, brand, model, quantity, min_stock_alert, store_name, room_name, shelf_name)
        VALUES ('prod-trans-01', 'REF-TRANS-01', 'Bosch', 'Perfo GBH', 20, 5, 'Dépôt Central', 'A', 'R1')
        RETURNING id;
      `);
      const productId = String(prodRes.rows[0].id);

      // Transférer 7 unités de "Dépôt Central" vers "Camionnette 1" (emplacement "Bac Latéral")
      const transferRes = await db.query<{ res: any }>(
        `SELECT public.process_stock_movement(
          '11111111-1111-4111-8111-000000000001'::uuid,
          $1::text,
          'Dépôt Central',
          'TRANSFER',
          7,
          'Dotation véhicule',
          NULL,
          NULL,
          'Camionnette 1',
          'Bac Latéral',
          '{}'::jsonb
        ) AS res;`,
        [productId]
      );

      expect(transferRes.rows[0].res).toMatchObject({
        success: true,
        depot_quantity: 13,
        dest_depot_quantity: 7,
        new_quantity: 20,
      });

      // Vérifier stock_levels pour les deux dépôts
      const levels = await db.query<{ depot_name: string; quantity: number; rack_location: string }>(
        `SELECT depot_name, quantity::int AS quantity, rack_location
         FROM public.stock_levels
         WHERE product_id = $1
         ORDER BY depot_name;`,
        [productId]
      );

      expect(levels.rows).toEqual([
        expect.objectContaining({ depot_name: 'Camionnette 1', quantity: 7, rack_location: 'Bac Latéral' }),
        expect.objectContaining({ depot_name: 'Dépôt Central', quantity: 13 }),
      ]);

      // Vérifier que la quantité globale du produit est inchangée (13 + 7 = 20)
      const globalProd = await db.query<{ quantity: number }>(
        `SELECT quantity::int AS quantity FROM public.products WHERE id::text = $1;`,
        [productId]
      );
      expect(globalProd.rows[0].quantity).toBe(20);

      // Vérifier qu'un transfert avec stock insuffisant est rejeté par la transaction
      await expect(
        db.query(
          `SELECT public.process_stock_movement(
            '11111111-1111-4111-8111-000000000002'::uuid,
            $1::text,
            'Dépôt Central',
            'TRANSFER',
            50,
            NULL,
            NULL,
            NULL,
            'Camionnette 1',
            NULL,
            '{}'::jsonb
          );`,
          [productId]
        )
      ).rejects.toThrow(/Stock insuffisant/i);

      // Vérifier qu'un transfert vers le même dépôt échoue
      await expect(
        db.query(
          `SELECT public.process_stock_movement(
            '11111111-1111-4111-8111-000000000003'::uuid,
            $1::text,
            'Dépôt Central',
            'TRANSFER',
            2,
            NULL,
            NULL,
            NULL,
            'Dépôt Central',
            NULL,
            '{}'::jsonb
          );`,
          [productId]
        )
      ).rejects.toThrow(/distinct du dépôt source/i);
    });

    it('SQL : process_stock_movement applique un comptage d’inventaire (INVENTORY), recalcule le stock multi-dépôts et journalise l’écart', async () => {
      // Sur l'article REF-TRANS-01 : Dépôt Central = 13, Camionnette 1 = 7 (total = 20).
      // On réalise un inventaire physique au Dépôt Central : stock compté = 10 (écart = -3).
      const prodRow = await db.query<{ id: string }>(
        `SELECT id FROM public.products WHERE reference = 'REF-TRANS-01';`
      );
      const productId = String(prodRow.rows[0].id);

      const invRes = await db.query<{ res: any }>(
        `SELECT public.process_stock_movement(
          '11111111-1111-4111-8111-000000000004'::uuid,
          $1::text,
          'Dépôt Central',
          'INVENTORY',
          10,
          'Inventaire annuel Q4',
          NULL,
          NULL,
          NULL,
          NULL,
          '{}'::jsonb
        ) AS res;`,
        [productId]
      );

      expect(invRes.rows[0].res).toMatchObject({
        success: true,
        old_quantity: 13,
        depot_quantity: 10,
        new_quantity: 17, // 10 (Dépôt Central) + 7 (Camionnette 1)
      });

      // Vérifier que products.quantity vaut bien 17
      const updatedProd = await db.query<{ quantity: number }>(
        `SELECT quantity::int AS quantity FROM public.products WHERE id::text = $1;`,
        [productId]
      );
      expect(updatedProd.rows[0].quantity).toBe(17);

      // Vérifier que le mouvement journalisé dans stock_movements enregistre l'écart (3) en sortie ('OUT')
      const movRows = await db.query<{ movement_type: string; quantity_changed: number; depot_name: string }>(
        `SELECT movement_type, quantity_changed::int AS quantity_changed, depot_name
         FROM public.stock_movements
         WHERE product_id::text = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 1;`,
        [productId]
      );
      expect(movRows.rows[0]).toEqual({
        movement_type: 'OUT',
        quantity_changed: 3,
        depot_name: 'Dépôt Central',
      });
    });

    it('pushMovementToSupabase et transitionOrderStatusSupabase n’effectuent aucune écriture directe en cas d’erreur RPC et signalent isNetworkError', async () => {
      const fromSpy = vi.fn();
      const rpcSpy = vi.fn(async () => ({
        data: null,
        error: { message: 'Failed to fetch (network down)' },
      }));

      const fakeClient = {
        rpc: rpcSpy,
        from: fromSpy,
      } as any;

      const movRes = await pushMovementToSupabase(
        fakeClient,
        {
          id: 'mov-1',
          product_id: '12',
          movement_type: 'OUT',
          type: 'TRANSFER',
          quantity_changed: 4,
          quantity: 4,
          created_at: new Date().toISOString(),
          user_id: 1,
          depot_name: 'Dépôt Central',
          dest_depot_name: 'Camionnette 1',
          dest_rack: 'Étagère 2',
        },
        20,
        1,
        'op-test-transfer',
        'Camionnette 1',
        'Étagère 2'
      );

      expect(movRes.success).toBe(false);
      expect(movRes.isNetworkError).toBe(true);
      expect(fromSpy).not.toHaveBeenCalled();
      expect(rpcSpy).toHaveBeenCalledWith(
        'process_stock_movement',
        expect.objectContaining({
          p_operation_id: 'op-test-transfer',
          p_product_id: '12',
          p_type: 'TRANSFER',
          p_quantity: 4,
          p_depot_name: 'Dépôt Central',
          p_dest_depot_name: 'Camionnette 1',
          p_dest_rack: 'Étagère 2',
        })
      );

      const orderRes = await transitionOrderStatusSupabase(
        fakeClient,
        '55',
        'APPROVED',
        'Validation chef',
        '1',
        'op-test-order'
      );
      expect(orderRes.success).toBe(false);
      expect(orderRes.isNetworkError).toBe(true);
      expect(fromSpy).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 3. SYNCHRONISATION HORS LIGNE — IndexedDB & reprise après coupure
  // ===========================================================================
  describe('3. Synchronisation hors ligne — IndexedDB source de référence et reprise après coupure', () => {
    beforeEach(async () => {
      for (const s of ALL_STORE_NAMES) {
        await clearStore(s);
      }
      const store = new Map<string, string>();
      (globalThis as any).localStorage = {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => store.set(k, String(v)),
        removeItem: (k: string) => store.delete(k),
        clear: () => store.clear(),
      };
    });

    it('hydrateAllFromIndexedDb et replaceStoreContents font d’IndexedDB la source locale de référence (y compris après suppression)', async () => {
      const p1: Product = {
        id: '101',
        reference: 'REF-101',
        brand: 'Makita',
        model: 'Visseuse',
        unit_price: 150,
        quantity: 12,
        min_stock_alert: 3,
      };
      const p2: Product = {
        id: '102',
        reference: 'REF-102',
        brand: 'Hilti',
        model: 'Perfo',
        unit_price: 420,
        quantity: 4,
        min_stock_alert: 1,
      };

      await replaceStoreContents('products', [p1, p2]);
      let hydrated = await hydrateAllFromIndexedDb();
      expect(hydrated.products).toHaveLength(2);

      // Suppression de p1 : replaceStoreContents doit refléter exactement la liste restante
      await replaceStoreContents('products', [p2]);
      hydrated = await hydrateAllFromIndexedDb();
      expect(hydrated.products).toHaveLength(1);
      expect(hydrated.products[0].id).toBe('102');
    });

    it('processSyncQueue rejoue les opérations TRANSFER, INVENTORY et commandes _OFF et réconcilie IndexedDB', async () => {
      // Pré-remplir IndexedDB avec l'article #10 et la commande hors-ligne #99001
      await putToStore<Product>('products', {
        id: '10',
        reference: 'REF-10',
        brand: 'Bosch',
        model: 'Disqueuse',
        unit_price: 90,
        quantity: 25,
        min_stock_alert: 5,
      });

      const offlineOrder: MaterialOrder = {
        id: '99001',
        order_number: 'CH-100-CMD-261104-1_OFF',
        site_number: 'CH-100',
        site_name: 'Chantier Gare',
        requester_id: '1',
        requester_name: 'Admin',
        status: 'WAITING_APPROVAL',
        created_at: new Date().toISOString(),
        items: [
          {
            product_id: '10',
            product_ref: 'REF-10',
            product_name: 'Disqueuse',
            quantity: 2,
            unit: 'pce',
          },
        ],
      };
      await putToStore<MaterialOrder>('material_orders', offlineOrder);

      // Enfiler 1 transfert, 1 inventaire et 1 création de commande hors-ligne
      await enqueueSyncOperation(
        'stock_movements',
        'RPC_STOCK_MOVEMENT',
        {
          product_id: '10',
          type: 'TRANSFER',
          quantity: 5,
          depot_name: 'Dépôt Central',
          dest_depot_name: 'Camionnette 1',
          dest_rack: 'Casier B',
        },
        'op-sync-transfer-1'
      );

      await enqueueSyncOperation(
        'stock_movements',
        'RPC_STOCK_MOVEMENT',
        {
          product_id: '10',
          type: 'INVENTORY',
          quantity: 18,
          depot_name: 'Dépôt Central',
          reason: 'Comptage',
        },
        'op-sync-inv-1'
      );

      await enqueueSyncOperation(
        'material_orders',
        'INSERT',
        offlineOrder,
        'op-sync-order-1'
      );

      const rpcCalls: Array<{ fn: string; args: any }> = [];
      const mockClient = {
        rpc: vi.fn(async (fn: string, args: any) => {
          rpcCalls.push({ fn, args });
          if (fn === 'process_stock_movement') {
            return {
              data: {
                success: true,
                new_quantity: args.p_type === 'INVENTORY' ? 23 : 25,
                depot_quantity: args.p_type === 'INVENTORY' ? 18 : 20,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        }),
        from: vi.fn((table: string) => {
          if (table === 'material_orders') {
            return {
              select: () => ({
                limit: async () => ({ data: [{ id: 'existing-1' }], error: null }),
                ilike: async (_col: string, val: string) => {
                  // Simule qu'une autre commande possède déjà CH-100-CMD-261104-1_OFF sur le serveur
                  if (val === 'CH-100-CMD-261104-1_OFF') {
                    return {
                      data: [{ id: 'other-order-id', order_number: 'CH-100-CMD-261104-1_OFF' }],
                      error: null,
                    };
                  }
                  return {
                    data: [{ order_number: 'CH-100-CMD-261104-1_OFF' }],
                    error: null,
                  };
                },
              }),
              update: () => ({
                eq: () => ({
                  select: async () => ({ data: [], error: null }),
                }),
              }),
              upsert: async () => ({ data: null, error: null }),
            };
          }
          return {
            select: () => ({
              limit: async () => ({ data: [], error: null }),
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
            upsert: async () => ({ data: null, error: null }),
          };
        }),
      };

      const result = await processSyncQueue(mockClient as any);

      expect(result.processedCount).toBe(3);
      expect(result.syncedCount).toBe(3);
      expect(result.failedCount).toBe(0);
      expect(result.rejectedCount).toBe(0);

      // Vérifie que les paramètres de transfert (p_dest_depot_name, p_dest_rack) ont bien été transmis
      expect(rpcCalls[0]).toEqual({
        fn: 'process_stock_movement',
        args: expect.objectContaining({
          p_operation_id: 'op-sync-transfer-1',
          p_product_id: '10',
          p_type: 'TRANSFER',
          p_quantity: 5,
          p_depot_name: 'Dépôt Central',
          p_dest_depot_name: 'Camionnette 1',
          p_dest_rack: 'Casier B',
        }),
      });

      // Vérifie la réconciliation de la commande hors-ligne (_OFF -> numéro incrémenté sans collision)
      expect(result.updatedOrders).toEqual([
        {
          id: '99001',
          order_number: 'CH-100-CMD-261104-02_OFF',
        },
      ]);
      const reconciledOrder = await getByIdFromStore<MaterialOrder>('material_orders', '99001');
      expect(reconciledOrder?.order_number).toBe('CH-100-CMD-261104-02_OFF');

      // Vérifie que la quantité du produit a été mise à jour dans IndexedDB et dans updatedProductQuantities
      expect(result.updatedProductQuantities).toContainEqual({
        product_id: '10',
        new_quantity: 23,
        depot_quantity: 18,
      });
      const updatedProduct = await getByIdFromStore<Product>('products', '10');
      expect(updatedProduct?.quantity).toBe(23);
    });

    it('performIncrementalSync filtre stock_movements sur created_at et normalise les enregistrements dans IndexedDB', async () => {
      await setSyncMetadata('last_incremental_sync_at', '2026-11-01T00:00:00.000Z');

      const queriedFilters: Array<{ table: string; col: string; val: string }> = [];
      const mockClient = {
        from: (table: string) => ({
          select: () => ({
            gt: async (col: string, val: string) => {
              queriedFilters.push({ table, col, val });
              if (table === 'products') {
                return {
                  data: [
                    {
                      id: 10,
                      reference: 'REF-10',
                      brand: 'Bosch',
                      model: 'Perfo',
                      unit_price: 100,
                      quantity: 30,
                      min_stock_alert: 5,
                      updated_at: '2026-11-02T10:00:00.000Z',
                    },
                  ],
                  error: null,
                };
              }
              if (table === 'stock_movements') {
                return {
                  data: [
                    {
                      id: 88,
                      product_id: 10,
                      movement_type: 'IN',
                      quantity_changed: 5,
                      created_at: '2026-11-02T10:00:00.000Z',
                    },
                  ],
                  error: null,
                };
              }
              return { data: [], error: null };
            },
          }),
        }),
      };

      const ok = await performIncrementalSync(mockClient as any);
      expect(ok).toBe(true);

      // Vérifie que stock_movements est bien filtré sur created_at (et non sur timestamp)
      expect(queriedFilters).toContainEqual({
        table: 'stock_movements',
        col: 'created_at',
        val: '2026-11-01T00:00:00.000Z',
      });

      const storedProducts = await getAllFromStore<Product>('products');
      expect(storedProducts).toEqual([
        expect.objectContaining({ id: '10', reference: 'REF-10', quantity: 30 }),
      ]);

      const storedMovements = await getAllFromStore<any>('stock_movements');
      expect(storedMovements).toEqual([
        expect.objectContaining({ id: '88', product_id: '10', movement_type: 'IN', quantity_changed: 5 }),
      ]);
    });
  });
});
