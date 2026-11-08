import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  APP_VERSION,
  EXPECTED_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from '../appVersion';
import {
  SQL_STEPS,
  verifySqlArtifactsSync,
} from '../../scripts/build-sql.mjs';
import {
  SQL_SCRIPT_07_APP_COMPAT,
  SQL_SCRIPT_17_TRANSFERTS_VALIDES,
} from '../constants/supabaseScripts';
import {
  ALL_MENU_BUTTON_KEYS,
  MENU_PERMISSION_GROUPS,
} from '../data/permissionMatrix';
import { INITIAL_ROLES, RECOMMENDED_ROLES_SPEC } from '../data/initialData';
import { RECENT_CHANGELOG } from '../data/changelog';
import {
  buildReceiveTransferItemsPayload,
  canUserCancelTransfer,
  canUserConfirmTransferAdjustment,
  canUserInitiateTransfer,
  canUserReceiveTransfer,
  canUserResolveTransferDispute,
  canViewStockLevelsReport,
  computeProductInTransitQty,
  computeTransferBadgeCounts,
  depotHasReceiverHolder,
  getEligibleDestDepots,
  getEligibleSourceDepots,
  isTransferOverdue,
  mapStockLevelsReportRowsToProducts,
} from '../services/transferService';
import { Depot, DepotHolder, StockTransferLine, StockTransferRecord, User } from '../types';

const ROOT_DIR = path.resolve(__dirname, '../..');

const BOOTSTRAP_AUTH_SQL = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOLOGIN SUPERUSER;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  encrypted_password text,
  email_confirmed_at timestamptz DEFAULT now(),
  raw_app_meta_data jsonb DEFAULT '{"provider":"email","providers":["email"]}'::jsonb,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  aud text DEFAULT 'authenticated',
  role text DEFAULT 'authenticated',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth.identities (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identity_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text NOT NULL DEFAULT 'email',
  provider_id text NOT NULL DEFAULT '',
  last_sign_in_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $fn$
  SELECT NULLIF(
    COALESCE(
      current_setting('request.jwt.claim.sub', true),
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$fn$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    current_user::text
  );
$fn$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $fn$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
    jsonb_build_object(
      'sub', current_setting('request.jwt.claim.sub', true),
      'role', current_setting('request.jwt.claim.role', true)
    )
  );
$fn$;

GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt() TO PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE,
  description text,
  secret text NOT NULL,
  key_id uuid,
  nonce bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS
SELECT id, name, description, secret, secret AS decrypted_secret, key_id, nonce, created_at, updated_at
FROM vault.secrets;
CREATE OR REPLACE FUNCTION vault.create_secret(
  new_secret text,
  new_name text DEFAULT NULL,
  new_description text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO vault.secrets (name, description, secret)
  VALUES (new_name, COALESCE(new_description, ''), new_secret)
  ON CONFLICT (name) DO UPDATE
    SET secret = EXCLUDED.secret,
        description = EXCLUDED.description,
        updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
`;

const ORDERED_CLIENT_SCRIPTS = [
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
  '16_audit_trail.sql',
  '17_transferts_valides.sql',
  '07_app_compat.sql',
];

describe('Prompt v54 — Versions 5.13.0 / 2.7.0, Script 17_transferts_valides.sql & Lot 1 (Permissions)', () => {
  it('aligne APP_VERSION=5.13.0, EXPECTED_SCHEMA_VERSION=2.7.0, RECENT_CHANGELOG et déclare le script 17 dans SQL_STEPS (après 16 et avant 07)', () => {
    expect(APP_VERSION).toBe('5.13.0');
    expect(EXPECTED_SCHEMA_VERSION).toBe('2.7.0');
    expect(MIN_SUPPORTED_SCHEMA_VERSION).toBe('1.0.0');
    expect(RECENT_CHANGELOG[0].version).toBe('5.13.0');
    expect(RECENT_CHANGELOG[0].schemaVersion).toBe('2.7.0');

    const stepNumbers = SQL_STEPS.map((s: any) => String(s.step));
    const idx15 = stepNumbers.indexOf('15');
    const idx16 = stepNumbers.indexOf('16');
    const idx17 = stepNumbers.indexOf('17');
    const idx07 = stepNumbers.indexOf('07');
    expect(idx15).toBeGreaterThan(0);
    expect(idx16).toBe(idx15 + 1);
    expect(idx17).toBe(idx16 + 1);
    expect(idx07).toBe(idx17 + 1);

    expect(SQL_SCRIPT_17_TRANSFERTS_VALIDES).toContain('CREATE TABLE IF NOT EXISTS public.stk_depot_holders');
    expect(SQL_SCRIPT_17_TRANSFERTS_VALIDES).toContain('CREATE TABLE IF NOT EXISTS public.stk_transfers');
    expect(SQL_SCRIPT_17_TRANSFERTS_VALIDES).toContain('CREATE OR REPLACE FUNCTION public.set_depot_holders');
    expect(SQL_SCRIPT_17_TRANSFERTS_VALIDES).toContain('CREATE OR REPLACE FUNCTION public.send_stock_transfer');
    expect(SQL_SCRIPT_17_TRANSFERTS_VALIDES).toContain('CREATE OR REPLACE FUNCTION public.receive_stock_transfer');
    expect(SQL_SCRIPT_17_TRANSFERTS_VALIDES).toContain('CREATE OR REPLACE FUNCTION public.confirm_stock_transfer_adjustment');
    expect(SQL_SCRIPT_17_TRANSFERTS_VALIDES).toContain('CREATE OR REPLACE FUNCTION public.resolve_transfer_dispute');
    expect(SQL_SCRIPT_17_TRANSFERTS_VALIDES).toContain('CREATE OR REPLACE FUNCTION public.list_overdue_transfers');
    expect(SQL_SCRIPT_17_TRANSFERTS_VALIDES).toContain('CREATE OR REPLACE FUNCTION public.get_stock_levels_report');

    expect(SQL_SCRIPT_07_APP_COMPAT).toContain("'trg_audit_row'");
    expect(SQL_SCRIPT_07_APP_COMPAT).toContain("'send_stock_transfer'");
    expect(SQL_SCRIPT_07_APP_COMPAT).toContain("'receive_stock_transfer'");
    expect(SQL_SCRIPT_07_APP_COMPAT).toContain("'get_stock_levels_report'");

    const syncResult = verifySqlArtifactsSync(ROOT_DIR);
    expect(syncResult.errors).toEqual([]);
    expect(syncResult.inSync).toBe(true);
  });

  it('Lot 1 : déclare les 3 permissions v54 avec libellés FR/NL/EN et les attribue uniquement à Administrateur (1) et Responsable Logistique (6) (+ Super Admin 0)', () => {
    const v54Keys = [
      'perm_stock_transfer_store',
      'perm_stock_receive_all',
      'perm_report_stock_levels',
    ] as const;

    const allButtons = MENU_PERMISSION_GROUPS.flatMap((g) => g.buttons);

    for (const key of v54Keys) {
      expect(ALL_MENU_BUTTON_KEYS).toContain(key);
      const item = allButtons.find((entry) => entry.key === key);
      expect(item).toBeDefined();
      expect(item?.labelFr.length).toBeGreaterThan(5);
      expect(item?.labelNl?.length).toBeGreaterThan(5);
      expect(item?.labelEn.length).toBeGreaterThan(5);
    }

    for (const roleSpec of RECOMMENDED_ROLES_SPEC) {
      const hasAllThree = v54Keys.every((k) => roleSpec.permissions.includes(k));
      const hasAny = v54Keys.some((k) => roleSpec.permissions.includes(k));
      if (roleSpec.id === 0 || roleSpec.id === 1 || roleSpec.id === 6) {
        expect(hasAllThree).toBe(true);
      } else {
        expect(hasAny).toBe(false);
      }
    }

    for (const role of INITIAL_ROLES) {
      const hasAllThree = v54Keys.every((k) => role.permissions?.includes(k));
      const hasAny = v54Keys.some((k) => role.permissions?.includes(k));
      if (role.id === 0 || role.id === 1 || role.id === 6) {
        expect(hasAllThree).toBe(true);
      } else {
        expect(hasAny).toBe(false);
      }
    }
  });
});

describe('Prompt v54 — Lots 2, 3, 4 & 5 : Logique JS (responsables de dépôt, filtrage source/destination, réception ligne par ligne, badge, en transit, rapports)', () => {
  const sampleDepots: Depot[] = [
    { id: '1', name: 'Magasin Central', type: 'FIXED', is_active: true },
    { id: '2', name: 'Camionnette Jean', type: 'VEHICLE', is_active: true },
    { id: '3', name: 'Camionnette Paul', type: 'VEHICLE', is_active: true },
    { id: '4', name: 'Conteneur Sans Receveur', type: 'CONTAINER', is_active: true },
  ];

  const sampleUsers: User[] = [
    { id: '0', name: 'Super Admin', trigram: 'ADM', role_id: 0, is_blocked: false },
    { id: '10', name: 'Jean Technicien', trigram: 'JEA', role_id: 3, is_blocked: false },
    { id: '20', name: 'Paul Technicien', trigram: 'PAU', role_id: 3, is_blocked: false },
    { id: '30', name: 'Luc Magasinier', trigram: 'LUC', role_id: 2, is_blocked: false },
    { id: '60', name: 'Marc Logistique', trigram: 'MAR', role_id: 6, is_blocked: false },
  ];

  const sampleHolders: DepotHolder[] = [
    { depot_id: '1', user_id: '30', can_send: true, can_receive: true },
    { depot_id: '2', user_id: '10', can_send: true, can_receive: true },
    { depot_id: '3', user_id: '20', can_send: false, can_receive: true },
    // depot 4 only has can_send = true, no can_receive = true
    { depot_id: '4', user_id: '10', can_send: true, can_receive: false },
  ];

  it('filtre les dépôts sources selon stk_depot_holders et perm_stock_transfer_store, et masque le bouton Transférer si aucun dépôt source éligible', () => {
    const jean = sampleUsers.find((u) => u.id === '10')!;
    const paul = sampleUsers.find((u) => u.id === '20')!;
    const marc = sampleUsers.find((u) => u.id === '60')!;

    // Jean est titulaire can_send des dépôts 2 et 4
    const jeanSources = getEligibleSourceDepots(jean, sampleDepots, sampleHolders, false);
    expect(jeanSources.map((d) => d.id)).toEqual(['2', '4']);
    expect(canUserInitiateTransfer(jean, sampleDepots, sampleHolders, false)).toBe(true);

    // Paul n'a can_send sur aucun dépôt et n'a pas perm_stock_transfer_store -> aucun dépôt source, bouton masqué
    const paulSources = getEligibleSourceDepots(paul, sampleDepots, sampleHolders, false);
    expect(paulSources).toHaveLength(0);
    expect(canUserInitiateTransfer(paul, sampleDepots, sampleHolders, false)).toBe(false);

    // Marc a perm_stock_transfer_store -> peut expédier depuis les dépôts FIXED (dépôt 1)
    const marcSources = getEligibleSourceDepots(marc, sampleDepots, sampleHolders, true);
    expect(marcSources.map((d) => d.id)).toEqual(['1']);
    expect(canUserInitiateTransfer(marc, sampleDepots, sampleHolders, true)).toBe(true);
  });

  it('filtre les dépôts de destination (uniquement ceux ayant au moins un titulaire can_receive) et expose les noms des responsables', () => {
    expect(depotHasReceiverHolder(sampleDepots[0], sampleHolders, sampleUsers)).toBe(true);
    expect(depotHasReceiverHolder(sampleDepots[3], sampleHolders, sampleUsers)).toBe(false);

    const destFromDepot2 = getEligibleDestDepots(
      sampleDepots,
      sampleHolders,
      sampleUsers,
      'Camionnette Jean'
    );
    // Dépôt 2 est exclu (source) et Dépôt 4 est exclu (aucun can_receive) -> restent 1 et 3
    expect(destFromDepot2.map((d) => d.depot.id)).toEqual(['1', '3']);
    expect(destFromDepot2[0].receiverNamesLabel).toContain('Luc Magasinier (LUC)');
    expect(destFromDepot2[1].receiverNamesLabel).toContain('Paul Technicien (PAU)');
  });

  it('construit le payload p_items de receive_stock_transfer (omet les lignes acceptées sans modification, exige un motif pour refus/modification, interdit les surplus)', () => {
    const lines: StockTransferLine[] = [
      { product_id: 'p1', product_ref: 'REF-1', quantity: 5, quantity_sent: 5 },
      { product_id: 'p2', product_ref: 'REF-2', quantity: 4, quantity_sent: 4 },
      { product_id: 'p3', product_ref: 'REF-3', quantity: 2, quantity_sent: 2 },
    ];

    // 1. Tout accepter par défaut -> p_items = [], statut prévu RECEIVED
    const allAccepted = buildReceiveTransferItemsPayload(lines, {});
    expect(allAccepted.valid).toBe(true);
    expect(allAccepted.itemsPayload).toEqual([]);
    expect(allAccepted.predictedStatus).toBe('RECEIVED');

    // 2. Refus sans motif -> invalide
    const missingRefuseReason = buildReceiveTransferItemsPayload(lines, {
      p2: { product_id: 'p2', mode: 'REFUSE', quantity_received: 0, reason: '   ' },
    });
    expect(missingRefuseReason.valid).toBe(false);
    expect(missingRefuseReason.error).toContain('REF-2');

    // 3. Modification avec surplus -> invalide
    const surplusRes = buildReceiveTransferItemsPayload(lines, {
      p1: { product_id: 'p1', mode: 'MODIFY', quantity_received: 6, reason: 'Trop reçu' },
    });
    expect(surplusRes.valid).toBe(false);
    expect(surplusRes.error).toContain('Surplus interdit');

    // 4. Modification valide (3 reçus sur 5) + refus valide sur p3 -> p_items ne contient que p1 et p3, statut prévu AWAITING_SENDER
    const mixedRes = buildReceiveTransferItemsPayload(lines, {
      p1: { product_id: 'p1', mode: 'MODIFY', quantity_received: 3, reason: '2 cassés' },
      p2: { product_id: 'p2', mode: 'ACCEPT', quantity_received: 4, reason: '' },
      p3: { product_id: 'p3', mode: 'REFUSE', quantity_received: 0, reason: 'Mauvaise réf' },
    });
    expect(mixedRes.valid).toBe(true);
    expect(mixedRes.acceptedCount).toBe(1);
    expect(mixedRes.modifiedCount).toBe(1);
    expect(mixedRes.refusedCount).toBe(1);
    expect(mixedRes.predictedStatus).toBe('AWAITING_SENDER');
    expect(mixedRes.itemsPayload).toEqual([
      { product_id: 'p1', accepted: true, quantity_received: 3, reason: '2 cassés' },
      { product_id: 'p3', accepted: false, quantity_received: 0, reason: 'Mauvaise réf' },
    ]);
  });

  it('calcule le badge des transferts, la séparation des tâches, le retard > 48 h et la quantité « En transit : N » par article', () => {
    const jean = sampleUsers.find((u) => u.id === '10')!;
    const paul = sampleUsers.find((u) => u.id === '20')!;
    const marc = sampleUsers.find((u) => u.id === '60')!;

    const transfers: StockTransferRecord[] = [
      {
        id: 'trf-1',
        transfer_number: 'TRF-2026-000001',
        batch_id: 'b1',
        source_depot_id: '2',
        source_depot: 'Camionnette Jean',
        dest_depot_id: '3',
        dest_depot: 'Camionnette Paul',
        status: 'IN_TRANSIT',
        items: [{ product_id: 'prod-A', product_ref: 'REF-A', quantity: 7, quantity_sent: 7 }],
        total_pieces: 7,
        total_cost: 70,
        sender_id: '10',
        created_at: new Date(Date.now() - 50 * 3600 * 1000).toISOString(), // 50h -> en retard
      },
      {
        id: 'trf-2',
        transfer_number: 'TRF-2026-000002',
        batch_id: 'b2',
        source_depot_id: '2',
        source_depot: 'Camionnette Jean',
        dest_depot_id: '3',
        dest_depot: 'Camionnette Paul',
        status: 'AWAITING_SENDER',
        items: [
          {
            product_id: 'prod-A',
            product_ref: 'REF-A',
            quantity: 4,
            quantity_sent: 4,
            quantity_received: 3,
            quantity_pending: 1,
          },
        ],
        total_pieces: 4,
        total_cost: 40,
        sender_id: '10',
        receiver_id: '20',
        created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      },
      {
        id: 'trf-3',
        transfer_number: 'TRF-2026-000003',
        batch_id: 'b3',
        source_depot_id: '1',
        source_depot: 'Magasin Central',
        dest_depot_id: '2',
        dest_depot: 'Camionnette Jean',
        status: 'DISPUTED',
        items: [{ product_id: 'prod-B', product_ref: 'REF-B', quantity: 2, quantity_sent: 2 }],
        total_pieces: 2,
        total_cost: 20,
        sender_id: '30',
        receiver_id: '10',
        created_at: new Date().toISOString(),
      },
    ];

    // Séparation des tâches : Jean (expéditeur de trf-1) ne peut pas recevoir trf-1, mais Paul (titulaire réception de dépôt 3) peut
    expect(canUserReceiveTransfer(transfers[0], jean, sampleDepots, sampleHolders, false)).toBe(false);
    expect(canUserReceiveTransfer(transfers[0], paul, sampleDepots, sampleHolders, false)).toBe(true);
    expect(canUserCancelTransfer(transfers[0], jean, sampleDepots, sampleHolders)).toBe(true);

    // Sur trf-2 (AWAITING_SENDER) : Paul (receveur) ne peut pas confirmer son propre ajustement, Jean (expéditeur) peut
    expect(canUserConfirmTransferAdjustment(transfers[1], paul, sampleDepots, sampleHolders)).toBe(false);
    expect(canUserConfirmTransferAdjustment(transfers[1], jean, sampleDepots, sampleHolders)).toBe(true);

    // Arbitrage des litiges : Marc (perm_stock_receive_all = true) peut, Jean ne peut pas
    expect(canUserResolveTransferDispute(jean, false)).toBe(false);
    expect(canUserResolveTransferDispute(marc, true)).toBe(true);

    // Badges
    const paulBadges = computeTransferBadgeCounts(transfers, paul, sampleDepots, sampleHolders, false);
    expect(paulBadges.toReceiveCount).toBe(1);
    expect(paulBadges.toConfirmCount).toBe(0);
    expect(paulBadges.totalBadgeCount).toBe(1);

    const jeanBadges = computeTransferBadgeCounts(transfers, jean, sampleDepots, sampleHolders, false);
    expect(jeanBadges.toReceiveCount).toBe(0);
    expect(jeanBadges.toConfirmCount).toBe(1);
    expect(jeanBadges.totalBadgeCount).toBe(1);

    const marcBadges = computeTransferBadgeCounts(transfers, marc, sampleDepots, sampleHolders, true);
    expect(marcBadges.disputedCount).toBe(1);

    // Retard > 48h
    expect(isTransferOverdue(transfers[0], 48)).toBe(true);
    expect(isTransferOverdue(transfers[1], 48)).toBe(false);

    // Quantité « En transit : N » (uniquement les transferts IN_TRANSIT)
    expect(computeProductInTransitQty('prod-A', transfers)).toBe(7);
    expect(computeProductInTransitQty('prod-B', transfers)).toBe(0);
  });

  it('Lot 5 : masque les rapports de niveau de stock sans perm_report_stock_levels (sauf rôles 0/1) et mappe les lignes de get_stock_levels_report', () => {
    const admin = sampleUsers.find((u) => u.id === '0')!;
    const jean = sampleUsers.find((u) => u.id === '10')!;
    const marc = sampleUsers.find((u) => u.id === '60')!;

    expect(canViewStockLevelsReport(admin, false)).toBe(true);
    expect(canViewStockLevelsReport(jean, false)).toBe(false);
    expect(canViewStockLevelsReport(marc, true)).toBe(true);

    const mapped = mapStockLevelsReportRowsToProducts(
      [
        {
          product_id: 'prod-1',
          reference: 'REF-001',
          brand: 'Bosch',
          model: 'Perceuse',
          sub_category_id: 2,
          depot_name: 'Magasin Central',
          rack_location: 'A-01',
          quantity: 1,
          min_stock_alert: 3,
          unit_price: 99,
          total_value: 99,
          in_transit_qty: 4,
          is_low_stock: true,
          is_out_of_stock: false,
        },
      ],
      [{ id: 'prod-1', reference: 'REF-001', supplier_1_name: 'Fournisseur Pro' }]
    );
    expect(mapped).toHaveLength(1);
    expect(mapped[0].store_name).toBe('Magasin Central');
    expect(mapped[0].quantity).toBe(1);
    expect(mapped[0].min_stock_alert).toBe(3);
    expect(mapped[0].supplier_1_name).toBe('Fournisseur Pro');
  });
});

describe('Prompt v54 — Tests SQL PGlite de 17_transferts_valides.sql & 07_app_compat.sql', () => {
  it(
    'valide le cycle complet des transferts (set_depot_holders, send_stock_transfer, receive_stock_transfer complet/partiel/refusé/modifié, confirm_stock_transfer_adjustment, resolve_transfer_dispute, cancel, reject, list_overdue_transfers, get_stock_levels_report et diagnostic_installation)',
    async () => {
      const db = new PGlite();
      await db.exec(BOOTSTRAP_AUTH_SQL);
      for (const scriptName of ORDERED_CLIENT_SCRIPTS) {
        const sql = fs.readFileSync(path.join(ROOT_DIR, 'supabase-client', scriptName), 'utf8');
        await db.exec(sql);
      }

      // Idempotence : rejouer 17 et 07 une seconde fois
      await db.exec(
        fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/17_transferts_valides.sql'), 'utf8')
      );
      await db.exec(
        fs.readFileSync(path.join(ROOT_DIR, 'supabase-client/07_app_compat.sql'), 'utf8')
      );

      const UUID_ADMIN = '00000000-0000-4000-8000-000000000001';
      const UUID_LOGISTIQUE = '00000000-0000-4000-8000-000000000006';
      const UUID_TECH_A = '00000000-0000-4000-8000-000000000010';
      const UUID_TECH_B = '00000000-0000-4000-8000-000000000020';

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${UUID_ADMIN}', 'admin@tot.local'),
          ('${UUID_LOGISTIQUE}', 'logistique@tot.local'),
          ('${UUID_TECH_A}', 'techa@tot.local'),
          ('${UUID_TECH_B}', 'techb@tot.local')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.core_users (id, name, email, pin, trigram, role_id, auth_user_id, is_blocked)
        VALUES
          ('u-admin', 'Super Admin', 'admin@tot.local', '', 'ADM', 0, '${UUID_ADMIN}', false),
          ('u-log', 'Marc Logistique', 'logistique@tot.local', '', 'MAR', 6, '${UUID_LOGISTIQUE}', false),
          ('u-a', 'Jean Tech A', 'techa@tot.local', '', 'JEA', 3, '${UUID_TECH_A}', false),
          ('u-b', 'Paul Tech B', 'techb@tot.local', '', 'PAU', 3, '${UUID_TECH_B}', false)
        ON CONFLICT (id) DO UPDATE
          SET role_id = EXCLUDED.role_id,
              auth_user_id = EXCLUDED.auth_user_id,
              is_blocked = false;

        UPDATE public.core_license_config
        SET
          plan_type = 'pro',
          max_depots = 10,
          signed_token = '{"plan":"pro","max_depots":10,"max_references":1000,"signature":"ed25519_valid_sig_v54_test"}'
        WHERE id = 'active_license';

        INSERT INTO public.stk_depots (id, name, type, is_active)
        VALUES
          ('dep-store', 'Magasin Principal', 'FIXED', true),
          ('dep-van-a', 'Camionnette A', 'VEHICLE', true),
          ('dep-van-b', 'Camionnette B', 'VEHICLE', true),
          ('dep-empty', 'Conteneur Sans Titulaire', 'CONTAINER', true)
        ON CONFLICT (name) DO UPDATE
          SET id = EXCLUDED.id, type = EXCLUDED.type, is_active = true;

        INSERT INTO public.stk_products (id, reference, brand, model, quantity, min_stock_alert, unit_price, store_name, shelf_name)
        VALUES
          ('p-1', 'REF-V54-1', 'Bosch', 'Perfo', 20, 5, 100, 'Magasin Principal', 'A1'),
          ('p-2', 'REF-V54-2', 'Makita', 'Visseuse', 10, 5, 50, 'Magasin Principal', 'A2'),
          ('p-zero', 'REF-V54-0', 'Hilti', 'Cheville', 0, 5, 10, 'Magasin Principal', 'A3')
        ON CONFLICT (id) DO UPDATE
          SET quantity = EXCLUDED.quantity, min_stock_alert = EXCLUDED.min_stock_alert;

        DELETE FROM public.stk_stock_levels WHERE product_id IN ('p-1', 'p-2', 'p-zero');
        INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, min_alert, rack_location)
        VALUES
          ('p-1', 'Magasin Principal', 15, 5, 'A1'),
          ('p-1', 'Camionnette A', 5, 2, 'V1'),
          ('p-2', 'Magasin Principal', 8, 5, 'A2'),
          ('p-2', 'Camionnette A', 2, 1, 'V2'),
          ('p-zero', 'Magasin Principal', 0, 5, 'A3');
      `);

      // 1. Diagnostic d'installation : unknown_stock_triggers = OK (avec trg_audit_row), app_compat = OK (2.7.0)
      const diagRes = await db.query<{
        check_key: string;
        status: string;
        details: string;
      }>(`SELECT check_key, status, details FROM public.diagnostic_installation();`);
      const triggersCheck = diagRes.rows.find((r) => r.check_key === 'unknown_stock_triggers');
      const compatCheck = diagRes.rows.find((r) => r.check_key === 'app_compat');
      const sensitiveCheck = diagRes.rows.find((r) => r.check_key === 'sensitive_functions');
      expect(triggersCheck?.status).toBe('OK');
      expect(compatCheck?.status).toBe('OK');
      expect(compatCheck?.details).toContain('2.7.0');
      expect(sensitiveCheck?.status).toBe('OK');

      // 2. set_depot_holders : refusé pour un technicien sans perm_manage_depots, autorisé pour Admin (0)
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_TECH_A}', true);
      `);
      await expect(
        db.query(`SELECT public.set_depot_holders('dep-van-a', '[{"user_id":"u-a","can_send":true,"can_receive":true}]'::jsonb);`)
      ).rejects.toThrow();
      await db.exec(`ROLLBACK;`);

      // Admin configure les titulaires de dep-store, dep-van-a et dep-van-b
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_ADMIN}', true);
      `);
      await db.query(
        `SELECT public.set_depot_holders('dep-store', '[{"user_id":"u-log","can_send":true,"can_receive":true}]'::jsonb);`
      );
      await db.query(
        `SELECT public.set_depot_holders('dep-van-a', '[{"user_id":"u-a","can_send":true,"can_receive":true},{"user_id":"u-log","can_send":true,"can_receive":false}]'::jsonb);`
      );
      await db.query(
        `SELECT public.set_depot_holders('dep-van-b', '[{"user_id":"u-b","can_send":false,"can_receive":true}]'::jsonb);`
      );
      await db.exec(`COMMIT;`);

      // 3. send_stock_transfer :
      // - Tech B n'a pas can_send sur Camionnette B -> refusé
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_TECH_B}', true);
      `);
      await expect(
        db.query(`
          SELECT public.send_stock_transfer(
            '10000000-0000-4000-8000-000000000001'::uuid,
            'Camionnette B',
            'Camionnette A',
            '[{"product_id":"p-1","quantity":1}]'::jsonb,
            'Test refus source'
          );
        `)
      ).rejects.toThrow(/responsable.*envoi/i);
      await db.exec(`ROLLBACK;`);

      // - Tech A expédie vers un dépôt sans responsable réception (Conteneur Sans Titulaire) -> refusé
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_TECH_A}', true);
      `);
      await expect(
        db.query(`
          SELECT public.send_stock_transfer(
            '10000000-0000-4000-8000-000000000002'::uuid,
            'Camionnette A',
            'Conteneur Sans Titulaire',
            '[{"product_id":"p-1","quantity":1}]'::jsonb,
            'Test refus destination'
          );
        `)
      ).rejects.toThrow(/aucun responsable de réception/i);
      await db.exec(`ROLLBACK;`);

      // - Tech A expédie 3 unités de p-1 de Camionnette A vers Camionnette B -> IN_TRANSIT, stock source débité (5 -> 2)
      const batchFull = '10000100-0000-4000-8000-000000000010';
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_TECH_A}', true);
      `);
      const sendFullRes = await db.query<{ res: any }>(
        `SELECT public.send_stock_transfer($1::uuid, 'Camionnette A', 'Camionnette B', '[{"product_id":"p-1","quantity":3,"dest_rack":"B-R1"}]'::jsonb, 'Envoi complet') AS res;`,
        [batchFull]
      );
      await db.exec(`COMMIT;`);

      const trfFullId = sendFullRes.rows[0].res.transfer_id;
      expect(sendFullRes.rows[0].res.status).toBe('IN_TRANSIT');
      expect(sendFullRes.rows[0].res.transfer_number).toMatch(/^TRF-\d{4,8}-[A-F0-9]+$/);

      const vanAQtyAfterSend = await db.query<{ quantity: number }>(
        `SELECT quantity FROM public.stk_stock_levels WHERE product_id = 'p-1' AND depot_name = 'Camionnette A';`
      );
      expect(Number(vanAQtyAfterSend.rows[0].quantity)).toBe(2);

      // 4. Séparation des tâches : Tech A (expéditeur) ne peut pas valider lui-même la réception
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_TECH_A}', true);
      `);
      await expect(
        db.query(`SELECT public.receive_stock_transfer($1, '[]'::jsonb, 'Auto-réception');`, [trfFullId])
      ).rejects.toThrow(/Accès refusé|Séparation des tâches/i);
      await db.exec(`ROLLBACK;`);

      // 5. Tech B (responsable réception de Camionnette B) valide la réception complète -> RECEIVED, Camionnette B créditée (+3)
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_TECH_B}', true);
      `);
      const recFullRes = await db.query<{ res: any }>(
        `SELECT public.receive_stock_transfer($1, '[]'::jsonb, 'Tout bien reçu') AS res;`,
        [trfFullId]
      );
      await db.exec(`COMMIT;`);
      expect(recFullRes.rows[0].res.status).toBe('RECEIVED');

      const vanBQtyAfterReceive = await db.query<{ quantity: number }>(
        `SELECT quantity FROM public.stk_stock_levels WHERE product_id = 'p-1' AND depot_name = 'Camionnette B';`
      );
      expect(Number(vanBQtyAfterReceive.rows[0].quantity)).toBe(3);

      // 6. Réception avec quantité modifiée (surplus interdit, écart -> AWAITING_SENDER) puis confirmation par l'expéditeur -> PARTIALLY_RECEIVED
      const batchMod = '10000200-0000-4000-8000-000000000020';
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_LOGISTIQUE}', true);
      `);
      const sendModRes = await db.query<{ res: any }>(
        `SELECT public.send_stock_transfer($1::uuid, 'Magasin Principal', 'Camionnette B', '[{"product_id":"p-1","quantity":5}]'::jsonb, 'Envoi 5 pièces') AS res;`,
        [batchMod]
      );
      await db.exec(`COMMIT;`);
      const trfModId = sendModRes.rows[0].res.transfer_id;

      // Séparation des tâches : Marc Logistique (pourtant détenteur de perm_stock_receive_all) ne peut pas valider lui-même son propre envoi
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_LOGISTIQUE}', true);
      `);
      await expect(
        db.query(`SELECT public.receive_stock_transfer($1, '[]'::jsonb, 'Auto-réception logistique');`, [trfModId])
      ).rejects.toThrow(/Séparation des tâches/i);
      await db.exec(`ROLLBACK;`);

      // Surplus (6 > 5) refusé
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_TECH_B}', true);
      `);
      await expect(
        db.query(
          `SELECT public.receive_stock_transfer($1, '[{"product_id":"p-1","accepted":true,"quantity_received":6,"reason":"Surplus"}]'::jsonb, null);`,
          [trfModId]
        )
      ).rejects.toThrow(/comprise entre 1 et 5|Surplus interdit/i);
      await db.exec(`ROLLBACK;`);

      // Tech B déclare 3 reçus sur 5 -> AWAITING_SENDER (3 crédités en B, 2 en attente)
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_TECH_B}', true);
      `);
      const recModRes = await db.query<{ res: any }>(
        `SELECT public.receive_stock_transfer($1, '[{"product_id":"p-1","accepted":true,"quantity_received":3,"reason":"Seulement 3 dans le bac"}]'::jsonb, 'Écart constaté') AS res;`,
        [trfModId]
      );
      await db.exec(`COMMIT;`);
      expect(recModRes.rows[0].res.status).toBe('AWAITING_SENDER');

      // Le receveur Tech B ne peut pas confirmer lui-même son ajustement
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_TECH_B}', true);
      `);
      await expect(
        db.query(`SELECT public.confirm_stock_transfer_adjustment($1, true, 'Auto-confirm');`, [trfModId])
      ).rejects.toThrow(/Séparation des tâches/i);
      await db.exec(`ROLLBACK;`);

      // L'expéditeur (Marc Logistique) confirme l'écart -> PARTIALLY_RECEIVED et les 2 pièces en attente reviennent au Magasin Principal
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_LOGISTIQUE}', true);
      `);
      const confirmRes = await db.query<{ res: any }>(
        `SELECT public.confirm_stock_transfer_adjustment($1, true, 'Effectivement 2 oubliés sur le quai') AS res;`,
        [trfModId]
      );
      await db.exec(`COMMIT;`);
      expect(confirmRes.rows[0].res.status).toBe('PARTIALLY_RECEIVED');

      // 7. Contestation par l'expéditeur -> DISPUTED puis arbitrage WRITE_OFF par resolve_transfer_dispute
      const batchDispute = '10000300-0000-4000-8000-000000000030';
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_TECH_A}', true);
      `);
      const sendDispRes = await db.query<{ res: any }>(
        `SELECT public.send_stock_transfer($1::uuid, 'Camionnette A', 'Camionnette B', '[{"product_id":"p-2","quantity":2}]'::jsonb, 'Envoi visseuses') AS res;`,
        [batchDispute]
      );
      await db.exec(`COMMIT;`);
      const trfDispId = sendDispRes.rows[0].res.transfer_id;

      // Tech B déclare 1 reçu sur 2 -> AWAITING_SENDER
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_TECH_B}', true);
      `);
      await db.query(
        `SELECT public.receive_stock_transfer($1, '[{"product_id":"p-2","accepted":true,"quantity_received":1,"reason":"1 manquant"}]'::jsonb, null);`,
        [trfDispId]
      );
      await db.exec(`COMMIT;`);

      // Tech A conteste -> DISPUTED
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_TECH_A}', true);
      `);
      const contestRes = await db.query<{ res: any }>(
        `SELECT public.confirm_stock_transfer_adjustment($1, false, 'Les 2 étaient bien dans la caisse') AS res;`,
        [trfDispId]
      );
      await db.exec(`COMMIT;`);
      expect(contestRes.rows[0].res.status).toBe('DISPUTED');

      // Marc Logistique (perm_stock_receive_all) arbitre en WRITE_OFF
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_LOGISTIQUE}', true);
      `);
      const resolveRes = await db.query<{ res: any }>(
        `SELECT public.resolve_transfer_dispute($1, 'WRITE_OFF', '1 unité perdue pendant le transport') AS res;`,
        [trfDispId]
      );
      await db.exec(`COMMIT;`);
      expect(resolveRes.rows[0].res.status).toBe('PARTIALLY_RECEIVED');
      expect(resolveRes.rows[0].res.resolution_action).toBe('WRITE_OFF');

      // 8. cancel_stock_transfer & reject_stock_transfer + list_overdue_transfers
      const batchCancel = '10000400-0000-4000-8000-000000000040';
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_LOGISTIQUE}', true);
      `);
      const sendCancelRes = await db.query<{ res: any }>(
        `SELECT public.send_stock_transfer($1::uuid, 'Magasin Principal', 'Camionnette B', '[{"product_id":"p-2","quantity":2}]'::jsonb, 'Envoi à annuler') AS res;`,
        [batchCancel]
      );
      await db.exec(`COMMIT;`);
      const trfCancelId = sendCancelRes.rows[0].res.transfer_id;

      // Simuler un transfert de plus de 48h pour tester list_overdue_transfers
      await db.query(
        `UPDATE public.stk_transfers SET created_at = NOW() - INTERVAL '72 hours' WHERE id = $1;`,
        [trfCancelId]
      );

      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_LOGISTIQUE}', true);
      `);
      const overdueRes = await db.query<{ id: string }>(
        `SELECT id FROM public.list_overdue_transfers(48);`
      );
      expect(overdueRes.rows.some((r) => r.id === trfCancelId)).toBe(true);

      // Annuler le transfert -> CANCELLED
      const cancelRes = await db.query<{ res: any }>(
        `SELECT public.cancel_stock_transfer($1, 'Erreur de saisie') AS res;`,
        [trfCancelId]
      );
      await db.exec(`COMMIT;`);
      expect(cancelRes.rows[0].res.status).toBe('CANCELLED');

      // 9. get_stock_levels_report : refusé à Tech A (sans perm_report_stock_levels), autorisé à Marc Logistique (rôle 6)
      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_TECH_A}', true);
      `);
      await expect(
        db.query(`SELECT * FROM public.get_stock_levels_report(NULL, false);`)
      ).rejects.toThrow(/perm_report_stock_levels/i);
      await db.exec(`ROLLBACK;`);

      await db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_LOGISTIQUE}', true);
      `);
      const reportAllRes = await db.query<{
        product_id: string;
        depot_name: string;
        is_low_stock: boolean;
        is_out_of_stock: boolean;
      }>(`SELECT product_id, depot_name, is_low_stock, is_out_of_stock FROM public.get_stock_levels_report(NULL, true);`);
      await db.exec(`COMMIT;`);
      expect(reportAllRes.rows.length).toBeGreaterThan(0);
      expect(reportAllRes.rows.some((r) => r.product_id === 'p-zero' && r.is_out_of_stock)).toBe(true);

      await db.close();
    },
    60_000
  );
});
