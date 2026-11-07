import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

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

function readClientScript(filename) {
  return fs.readFileSync(path.join(ROOT_DIR, 'supabase-client', filename), 'utf8');
}

export async function runPrintJobsSqlTests() {
  const results = [];

  // ---------------------------------------------------------------------------
  // TEST 1A : Exécution sur une base vide (00 à 09 + 08 + 07) puis 2 passages d'affilée (idempotent)
  // Vérifie : seules les tables préfixées core_* et stk_* existent (aucune vue de compatibilité inutile sur base neuve),
  // schema_version = '2.0.0', min_schema_version = '1.0.0', et diagnostic_installation() = OK.
  // ---------------------------------------------------------------------------
  const db = new PGlite();
  await db.exec(AUTH_STUB_SQL);

  const orderedScripts = [
    '00_complete_tot_stock_schema.sql',
    '01_auth_link.sql',
    '01b_migrate_users_id_to_text.sql',
    '09_core_prefixes.sql',
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
    '07_app_compat.sql',
  ];

  // Passage 1
  for (const scriptName of orderedScripts) {
    await db.exec(readClientScript(scriptName));
  }
  // Passage 2 (idempotence complète)
  for (const scriptName of orderedScripts) {
    await db.exec(readClientScript(scriptName));
  }

  const compatRes = await db.query(
    `SELECT schema_version, min_schema_version FROM public.core_app_compat WHERE id = 1;`
  );
  if (
    compatRes.rows[0]?.schema_version !== '2.4.0' ||
    compatRes.rows[0]?.min_schema_version !== '1.0.0'
  ) {
    throw new Error(
      `Version de schéma inattendue après installation complète : ${JSON.stringify(compatRes.rows[0])}`
    );
  }

  // Sur base neuve : aucune vue de compatibilité ne doit avoir été créée
  const freshViewsRes = await db.query(`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v';
  `);
  if (freshViewsRes.rows.length !== 0) {
    throw new Error(
      `Sur une base neuve, aucune vue de compatibilité ne devait être créée, trouvé : ${JSON.stringify(freshViewsRes.rows)}`
    );
  }

  const diagRes = await db.query(`SELECT * FROM public.diagnostic_installation();`);
  const koRows = diagRes.rows.filter(
    (r) => r.check_key !== 'super_admin_linked' && (r.status === 'KO' || r.status === 'ERREUR')
  );
  if (koRows.length > 0 || diagRes.rows.length < 12) {
    throw new Error(
      `diagnostic_installation() a échoué après double passage : ${JSON.stringify(diagRes.rows)}`
    );
  }
  const prefixedDiagRow = diagRes.rows.find((r) => r.check_key === 'prefixed_tables');
  const compatViewsDiagRow = diagRes.rows.find((r) => r.check_key === 'compat_views_present');
  if (prefixedDiagRow?.status !== 'OK' || compatViewsDiagRow?.status !== 'OK') {
    throw new Error(
      `Sur base neuve, prefixed_tables et compat_views_present doivent être OK : ${JSON.stringify({ prefixedDiagRow, compatViewsDiagRow })}`
    );
  }
  results.push('1a_fresh_install_and_idempotent_two_passes_ok');

  // ---------------------------------------------------------------------------
  // TEST 1B : Mise à niveau d'une base existante en version 1.0.0 vers 2.0.0 via 08_print_jobs.sql seul
  // ---------------------------------------------------------------------------
  const dbUpgrade = new PGlite();
  await dbUpgrade.exec(AUTH_STUB_SQL);
  const v100Scripts = [
    '00_complete_tot_stock_schema.sql',
    '01_auth_link.sql',
    '09_core_prefixes.sql',
    '02_rls_hardening.sql',
    '03_rpc_stock_and_orders.sql',
    '04_mouvements_et_depots_vehicules.sql',
    '05_rpc_admin_users.sql',
    '06_install_additional_roles.sql',
    '11_suite_tables.sql',
    '12_user_preferences.sql',
    '13_transfer_stock_batch.sql',
    '14_mailing.sql',
    '07_app_compat.sql',
  ];
  for (const s of v100Scripts) {
    await dbUpgrade.exec(readClientScript(s));
  }
  // Simuler l'état 1.0.0 avant le script 08
  await dbUpgrade.exec(`
    DROP TABLE IF EXISTS public.stk_print_jobs CASCADE;
    DROP TABLE IF EXISTS public.stk_print_stations CASCADE;
    UPDATE public.core_app_compat SET schema_version = '1.0.0', min_schema_version = '1.0.0' WHERE id = 1;
  `);

  // Exécuter uniquement 08_print_jobs.sql (mise à niveau seule)
  await dbUpgrade.exec(readClientScript('08_print_jobs.sql'));
  // Et rejouer 08_print_jobs.sql une seconde fois
  await dbUpgrade.exec(readClientScript('08_print_jobs.sql'));

  const upgCompat = await dbUpgrade.query(
    `SELECT schema_version, min_schema_version FROM public.core_app_compat WHERE id = 1;`
  );
  if (upgCompat.rows[0]?.schema_version !== '2.0.0') {
    throw new Error(`La mise à niveau via 08_print_jobs.sql n'a pas mis à jour schema_version vers 2.0.0.`);
  }
  const upgDiag = await dbUpgrade.query(`SELECT * FROM public.diagnostic_installation();`);
  const upgKoRows = upgDiag.rows.filter(
    (r) => r.check_key !== 'super_admin_linked' && (r.status === 'KO' || r.status === 'ERREUR')
  );
  if (upgKoRows.length > 0 || upgDiag.rows.length < 12) {
    throw new Error(
      `diagnostic_installation() a échoué après mise à niveau : ${JSON.stringify(upgDiag.rows)}`
    );
  }
  await dbUpgrade.close();
  results.push('1b_upgrade_from_1_0_0_ok');

  // ---------------------------------------------------------------------------
  // Préparation des utilisateurs de test sur la base principale `db`
  // ---------------------------------------------------------------------------
  const UUID_NO_PERM = '00000000-0000-4000-8000-000000000010';
  const UUID_DEPOT_A = '00000000-0000-4000-8000-000000000020';
  const UUID_DEPOT_B = '00000000-0000-4000-8000-000000000030';
  const UUID_ADMIN = '00000000-0000-4000-8000-000000000099';

  await db.exec(`
    INSERT INTO public.core_roles (id, name, permissions)
    VALUES
      (10, 'Role Sans Impression', ARRAY['perm_inventory_view']::text[]),
      (20, 'Role Avec Impression', ARRAY['perm_menu_print_labels', 'perm_menu_order_prep', 'perm_orders_create']::text[])
    ON CONFLICT (id) DO UPDATE SET permissions = EXCLUDED.permissions;

    INSERT INTO auth.users (id, email)
    VALUES
      ('${UUID_NO_PERM}', 'noperm@test.local'),
      ('${UUID_DEPOT_A}', 'depota@test.local'),
      ('${UUID_DEPOT_B}', 'depotb@test.local'),
      ('${UUID_ADMIN}', 'admin@test.local')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.core_users (id, name, email, pin, role_id, is_blocked, allowed_depots, is_preparer, auth_user_id)
    VALUES
      ('user-no-perm', 'Sans Droit', 'noperm@test.local', '', 10, false, ARRAY['Dépôt Nord']::text[], true, '${UUID_NO_PERM}'),
      ('user-depot-a', 'Magasinier Nord', 'depota@test.local', '', 20, false, ARRAY['Dépôt Nord']::text[], true, '${UUID_DEPOT_A}'),
      ('user-depot-b', 'Magasinier Sud', 'depotb@test.local', '', 20, false, ARRAY['Dépôt Sud']::text[], true, '${UUID_DEPOT_B}'),
      ('user-admin', 'Super Admin', 'admin@test.local', '', 0, false, ARRAY['*']::text[], true, '${UUID_ADMIN}')
    ON CONFLICT (id) DO UPDATE SET
      role_id = EXCLUDED.role_id,
      allowed_depots = EXCLUDED.allowed_depots,
      auth_user_id = EXCLUDED.auth_user_id;
  `);

  async function setAuthUser(uuid) {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uuid}', false);`);
  }

  async function expectSqlFailure(fn, expectedSubstring) {
    let failed = false;
    try {
      await fn();
    } catch (err) {
      failed = true;
      const msg = String(err?.message || err);
      if (expectedSubstring && !msg.toLowerCase().includes(expectedSubstring.toLowerCase())) {
        throw new Error(`Erreur SQL attendue contenant "${expectedSubstring}", mais reçu : "${msg}"`);
      }
    }
    if (!failed) {
      throw new Error(`Une erreur SQL était attendue (${expectedSubstring || 'any'}) mais l'appel a réussi.`);
    }
  }

  // Enregistrer 2 postes légitimes (Dépôt Nord par user-depot-a, Dépôt Sud par user-depot-b)
  await setAuthUser(UUID_DEPOT_A);
  const stARes = await db.query(
    `SELECT public.register_print_station('Poste Magasin Nord', 'Dépôt Nord') AS id;`
  );
  const stationNordId = stARes.rows[0].id;

  await setAuthUser(UUID_DEPOT_B);
  const stBRes = await db.query(
    `SELECT public.register_print_station('Poste Magasin Sud', 'Dépôt Sud') AS id;`
  );
  const stationSudId = stBRes.rows[0].id;

  // ---------------------------------------------------------------------------
  // TEST 2 : Un utilisateur sans perm_menu_print_labels ne peut ni enregistrer un poste ni créer un travail
  // ---------------------------------------------------------------------------
  await setAuthUser(UUID_NO_PERM);
  await expectSqlFailure(
    () => db.query(`SELECT public.register_print_station('Poste Pirate', 'Dépôt Nord');`),
    'perm_menu_print_labels'
  );
  await expectSqlFailure(
    () =>
      db.query(
        `SELECT public.create_print_job($1::uuid, 'product_label', 'avery_70x37', '{"product_id":"P1","product_ref":"REF1"}'::jsonb, 1, NULL);`,
        [stationNordId]
      ),
    'perm_menu_print_labels'
  );
  results.push('2_permission_perm_menu_print_labels_enforced');

  // ---------------------------------------------------------------------------
  // TEST 3 : Un utilisateur ne peut pas envoyer un travail vers un poste d'un autre dépôt
  // ---------------------------------------------------------------------------
  await setAuthUser(UUID_DEPOT_A); // Autorisé uniquement sur 'Dépôt Nord'
  await expectSqlFailure(
    () =>
      db.query(
        `SELECT public.create_print_job($1::uuid, 'product_label', 'avery_70x37', '{"product_id":"P1","product_ref":"REF1"}'::jsonb, 1, NULL);`,
        [stationSudId]
      ),
    'dépôt'
  );
  results.push('3_cross_depot_print_job_blocked');

  // ---------------------------------------------------------------------------
  // TEST 4 : Un poste ne peut ni lire ni réclamer les travaux d'un autre poste
  // ---------------------------------------------------------------------------
  await setAuthUser(UUID_DEPOT_B);
  await db.query(
    `SELECT public.create_print_job($1::uuid, 'product_label', 'thermal_50x30', '{"product_id":"P2","product_ref":"REF2"}'::jsonb, 2, NULL);`,
    [stationSudId]
  );

  await setAuthUser(UUID_DEPOT_A);
  await expectSqlFailure(
    () => db.query(`SELECT * FROM public.claim_print_jobs($1::uuid);`, [stationSudId]),
    'propriétaire'
  );
  await expectSqlFailure(
    () => db.query(`SELECT * FROM public.list_station_print_jobs($1::uuid, 20);`, [stationSudId]),
    'propriétaire'
  );
  results.push('4_cross_station_read_and_claim_blocked');

  // ---------------------------------------------------------------------------
  // TEST 5 : claim_print_jobs appelé deux fois de suite ne renvoie pas le même travail deux fois
  // ---------------------------------------------------------------------------
  await setAuthUser(UUID_DEPOT_B);
  const claim1 = await db.query(`SELECT * FROM public.claim_print_jobs($1::uuid);`, [
    stationSudId,
  ]);
  const claim2 = await db.query(`SELECT * FROM public.claim_print_jobs($1::uuid);`, [
    stationSudId,
  ]);
  if (claim1.rows.length !== 1 || claim2.rows.length !== 0) {
    throw new Error(
      `claim_print_jobs devait renvoyer 1 travail au 1er appel et 0 au 2nd appel, reçu : ${claim1.rows.length} puis ${claim2.rows.length}`
    );
  }
  await db.query(`SELECT public.complete_print_job($1::uuid, true, NULL);`, [claim1.rows[0].id]);
  results.push('5_claim_print_jobs_idempotent_single_claim');

  // ---------------------------------------------------------------------------
  // TEST 6 : Limites respectées : copies entre 1 et 100, payload <= 2048 octets et sans HTML, 30 PENDING max par poste
  // ---------------------------------------------------------------------------
  await setAuthUser(UUID_DEPOT_A);
  await expectSqlFailure(
    () =>
      db.query(
        `SELECT public.create_print_job($1::uuid, 'product_label', 'avery_70x37', '{"product_id":"P1"}'::jsonb, 0, NULL);`,
        [stationNordId]
      ),
    'copies'
  );
  await expectSqlFailure(
    () =>
      db.query(
        `SELECT public.create_print_job($1::uuid, 'product_label', 'avery_70x37', '{"product_id":"P1"}'::jsonb, 101, NULL);`,
        [stationNordId]
      ),
    'copies'
  );

  const hugePayload = JSON.stringify({
    product_id: 'P1',
    blob: 'A'.repeat(2200),
  });
  await expectSqlFailure(
    () =>
      db.query(
        `SELECT public.create_print_job($1::uuid, 'product_label', 'avery_70x37', $2::jsonb, 1, NULL);`,
        [stationNordId, hugePayload]
      ),
    '2048'
  );

  await expectSqlFailure(
    () =>
      db.query(
        `SELECT public.create_print_job($1::uuid, 'product_label', 'avery_70x37', '{"product_id":"P1","product_ref":"<script>alert(1)</script>"}'::jsonb, 1, NULL);`,
        [stationNordId]
      ),
    'html'
  );

  await db.exec(`
    INSERT INTO public.stk_print_jobs (station_id, created_by, kind, format, payload, copies, status, created_at)
    SELECT
      '${stationNordId}'::uuid,
      'user-admin',
      'product_label',
      'avery_70x37',
      '{"product_id":"P1","product_ref":"REF-1"}'::jsonb,
      1,
      'PENDING',
      now() - interval '10 minutes'
    FROM generate_series(1, 30);
  `);

  await expectSqlFailure(
    () =>
      db.query(
        `SELECT public.create_print_job($1::uuid, 'product_label', 'avery_70x37', '{"product_id":"P31","product_ref":"REF31"}'::jsonb, 1, NULL);`,
        [stationNordId]
      ),
    '30 travaux'
  );

  await db.exec(`DELETE FROM public.stk_print_jobs WHERE station_id = '${stationNordId}'::uuid;`);
  results.push('6_limits_30_pending_copies_1_100_payload_2048_enforced');

  // ---------------------------------------------------------------------------
  // TEST 7 : anon n'a aucun droit sur stk_print_stations, stk_print_jobs ni sur les fonctions d'impression
  // ---------------------------------------------------------------------------
  const anonTableGrants = await db.query(`
    SELECT table_name, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee = 'anon'
      AND table_name IN ('stk_print_stations', 'stk_print_jobs');
  `);
  if (anonTableGrants.rows.length > 0) {
    throw new Error(
      `Le rôle anon possède des droits sur stk_print_stations/stk_print_jobs : ${JSON.stringify(anonTableGrants.rows)}`
    );
  }

  const anonFuncGrants = await db.query(`
    SELECT p.proname,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_exec
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'user_can_access_print_depot',
        'register_print_station',
        'list_print_stations',
        'create_print_job',
        'claim_print_jobs',
        'complete_print_job',
        'cancel_print_job',
        'purge_print_jobs',
        'get_print_job_status',
        'list_station_print_jobs'
      );
  `);
  const exposedFuncs = anonFuncGrants.rows.filter((r) => r.anon_can_exec === true);
  if (exposedFuncs.length > 0) {
    throw new Error(
      `Le rôle anon a le droit EXECUTE sur des fonctions d'impression : ${JSON.stringify(exposedFuncs)}`
    );
  }
  results.push('7_anon_zero_privileges_on_tables_and_functions');

  // ---------------------------------------------------------------------------
  // TEST 8 : dedupe_key empêche deux travaux PENDING identiques sur le même poste
  // ---------------------------------------------------------------------------
  await setAuthUser(UUID_DEPOT_A);
  const job1 = await db.query(
    `SELECT public.create_print_job($1::uuid, 'order_label', 'bin_90x50', '{"order_id":"ORD1","order_number":"CMD-2026-900"}'::jsonb, 1, 'order:CMD-2026-900') AS id;`,
    [stationNordId]
  );
  if (!job1.rows[0]?.id) {
    throw new Error('Le premier travail avec dedupe_key aurait dû être créé.');
  }

  await expectSqlFailure(
    () =>
      db.query(
        `SELECT public.create_print_job($1::uuid, 'order_label', 'bin_90x50', '{"order_id":"ORD1","order_number":"CMD-2026-900"}'::jsonb, 1, 'order:CMD-2026-900') AS id;`,
        [stationNordId]
      ),
    ''
  );

  await db.query(`SELECT public.cancel_print_job($1::uuid);`, [job1.rows[0].id]);
  const job2 = await db.query(
    `SELECT public.create_print_job($1::uuid, 'order_label', 'bin_90x50', '{"order_id":"ORD1","order_number":"CMD-2026-900"}'::jsonb, 1, 'order:CMD-2026-900') AS id;`,
    [stationNordId]
  );
  if (!job2.rows[0]?.id) {
    throw new Error('Après annulation du 1er travail, dedupe_key doit autoriser un nouveau travail PENDING.');
  }
  results.push('8_dedupe_key_prevents_duplicate_pending_jobs');

  // ---------------------------------------------------------------------------
  // TEST 9 (v37 / v42) : Purge intégrale des règles RLS parasites / récursives et contrôle diagnostic
  // ---------------------------------------------------------------------------
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.stk_material_order_items (
      id SERIAL PRIMARY KEY,
      order_id BIGINT,
      product_id TEXT,
      quantity INTEGER DEFAULT 1
    );
    ALTER TABLE public.stk_material_order_items ENABLE ROW LEVEL SECURITY;

    GRANT SELECT, INSERT, UPDATE, DELETE ON public.core_users TO anon;

    DROP POLICY IF EXISTS "Allow public access to users" ON public.core_users;
    CREATE POLICY "Allow public access to users" ON public.core_users
      FOR ALL TO public USING (true);

    DROP POLICY IF EXISTS "Accès total users" ON public.core_users;
    CREATE POLICY "Accès total users" ON public.core_users
      FOR ALL TO public USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Legacy recursive read users" ON public.core_users;
    CREATE POLICY "Legacy recursive read users" ON public.core_users
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.core_users u_rec
          WHERE u_rec.auth_user_id = auth.uid()
            AND (u_rec.role_id = 0 OR u_rec.id = core_users.id)
        )
      );

    DROP POLICY IF EXISTS "Legacy order policy referencing users" ON public.stk_material_orders;
    CREATE POLICY "Legacy order policy referencing users" ON public.stk_material_orders
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.core_users u_ord
          WHERE u_ord.auth_user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Allow public access to products" ON public.stk_products;
    CREATE POLICY "Allow public access to products" ON public.stk_products
      FOR ALL TO public USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Legacy public order items" ON public.stk_material_order_items;
    CREATE POLICY "Legacy public order items" ON public.stk_material_order_items
      FOR ALL TO public USING (true);

    DROP POLICY IF EXISTS "Parasite public print_stations" ON public.stk_print_stations;
    CREATE POLICY "Parasite public print_stations" ON public.stk_print_stations
      FOR ALL TO public USING (true);

    DROP POLICY IF EXISTS "Parasite anon print_jobs" ON public.stk_print_jobs;
    CREATE POLICY "Parasite anon print_jobs" ON public.stk_print_jobs
      FOR ALL TO anon USING (true);
  `);

  await expectSqlFailure(
    () =>
      db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_DEPOT_A}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
        INSERT INTO public.stk_material_orders (
          id, order_number, requester_id, requester_name, site_number, site_name, status, items
        ) VALUES (
          'ord-rec-fail', 'CMD-REC-FAIL', 'user-depot-a', 'Magasinier Nord', 'CH-100', 'Chantier', 'PENDING', '[]'::jsonb
        );
        COMMIT;
      `),
    'infinite recursion detected in policy for relation "core_users"'
  );
  await db.exec(`ROLLBACK;`);

  const diagBeforePurge = await db.query(`SELECT * FROM public.diagnostic_installation();`);
  const permissiveRowBefore = diagBeforePurge.rows.find(
    (r) => r.check_key === 'permissive_rls_policies'
  );
  if (!permissiveRowBefore || permissiveRowBefore.status !== 'ERREUR') {
    throw new Error(
      `diagnostic_installation() devait renvoyer ERREUR sur permissive_rls_policies avant purge, reçu : ${JSON.stringify(permissiveRowBefore)}`
    );
  }
  if (
    !permissiveRowBefore.details.includes('core_users') ||
    !permissiveRowBefore.details.includes('stk_products')
  ) {
    throw new Error(
      `permissive_rls_policies devait citer core_users et stk_products, reçu : ${permissiveRowBefore.details}`
    );
  }

  for (const scriptToReplay of [
    '02_rls_hardening.sql',
    '03_rpc_stock_and_orders.sql',
    '04_mouvements_et_depots_vehicules.sql',
    '05_rpc_admin_users.sql',
    '08_print_jobs.sql',
    '11_suite_tables.sql',
    '12_user_preferences.sql',
    '07_app_compat.sql',
  ]) {
    await db.exec(readClientScript(scriptToReplay));
  }

  const helperFnRes = await db.query(`
    SELECT proname FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_tot_drop_all_policies_on_table';
  `);
  if (helperFnRes.rows.length > 0) {
    throw new Error('La fonction temporaire _tot_drop_all_policies_on_table aurait dû être supprimée en fin de script 02.');
  }

  const expectedPoliciesByTable = {
    core_users: ['Authenticated read core_users'],
    stk_products: ['Admin write products', 'Authenticated read products'],
    stk_movements: ['Authenticated insert stk_movements', 'Authenticated read stk_movements'],
    stk_material_orders: [
      'Authenticated insert material_orders',
      'Authenticated read material_orders',
      'Authenticated update material_orders',
    ],
    stk_material_order_items: [
      'Read stk_material_order_items',
      'Write stk_material_order_items',
    ],
    stk_depots: ['Admin write depots', 'Authenticated read depots'],
    core_app_settings: ['Admin write app_settings', 'Anon public settings', 'Authenticated read app_settings'],
    core_company_settings: [
      'Admin write company_settings',
      'Anon public company_settings',
      'Authenticated read company_settings',
    ],
    core_license_config: ['Authenticated read license_config'],
    core_roles: ['Admin write roles', 'Authenticated read roles'],
    core_departments: ['Admin write departments', 'Authenticated read departments'],
    core_projects: ['Admin write core_projects', 'Authenticated read core_projects'],
    stk_sub_categories: ['Admin write sub_categories', 'Authenticated read sub_categories'],
    stk_stock_levels: ['Admin write stk_stock_levels', 'Authenticated read stk_stock_levels'],
    core_audit_logs: ['Authenticated insert audit_logs', 'Authenticated read audit_logs'],
    core_processed_operations: ['User read self processed_operations'],
    core_app_compat: ['Lecture de la compatibilité', 'Modification compatibilité admin'],
    stk_inventory_audits: [
      'Authenticated insert stk_inventory_audits',
      'Authenticated read stk_inventory_audits',
      'SuperAdmin delete stk_inventory_audits',
      'SuperAdmin update stk_inventory_audits',
    ],
    stk_inventory_audit_items: [
      'Authenticated insert stk_inventory_audit_items',
      'Authenticated read stk_inventory_audit_items',
      'SuperAdmin delete stk_inventory_audit_items',
      'SuperAdmin update stk_inventory_audit_items',
    ],
    stk_print_stations: [],
    stk_print_jobs: [],
  };

  for (const [tableName, expectedNames] of Object.entries(expectedPoliciesByTable)) {
    const polRes = await db.query(
      `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY policyname;`,
      [tableName]
    );
    const actualNames = polRes.rows.map((r) => r.policyname);
    const sortedExpected = [...expectedNames].sort();
    if (JSON.stringify(actualNames) !== JSON.stringify(sortedExpected)) {
      throw new Error(
        `Règles RLS inattendues sur public.${tableName} : attendu ${JSON.stringify(sortedExpected)}, obtenu ${JSON.stringify(actualNames)}`
      );
    }
  }

  const anonUsersPrivRes = await db.query(`
    SELECT
      has_table_privilege('anon', 'public.core_users', 'SELECT') AS can_select,
      has_table_privilege('anon', 'public.core_users', 'INSERT') AS can_insert,
      has_table_privilege('anon', 'public.core_users', 'UPDATE') AS can_update,
      has_table_privilege('anon', 'public.core_users', 'DELETE') AS can_delete;
  `);
  const anonPriv = anonUsersPrivRes.rows[0];
  if (anonPriv.can_select || anonPriv.can_insert || anonPriv.can_update || anonPriv.can_delete) {
    throw new Error(`Le rôle anon conserve des privilèges sur public.core_users : ${JSON.stringify(anonPriv)}`);
  }

  await expectSqlFailure(
    () =>
      db.exec(`
        BEGIN;
        SET LOCAL ROLE anon;
        SELECT count(*) FROM public.core_users;
        COMMIT;
      `),
    'permission denied'
  );
  await db.exec(`ROLLBACK;`);

  await db.exec(`
    BEGIN;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${UUID_DEPOT_A}', true);
    SELECT set_config('request.jwt.claim.role', 'authenticated', true);

    SELECT id, name, role_id FROM public.core_users WHERE id = 'user-depot-a';

    INSERT INTO public.stk_material_orders (
      id,
      order_number,
      requester_id,
      requester_name,
      site_number,
      site_name,
      status,
      items
    ) VALUES (
      'ord-rls-ok-001',
      'CMD-RLS-NON-RECURSIVE-001',
      'user-depot-a',
      'Magasinier Nord',
      'CH-100',
      'Chantier Test RLS',
      'PENDING',
      '[]'::jsonb
    );
    COMMIT;
  `);

  const insertedOrderRes = await db.query(
    `SELECT order_number, status FROM public.stk_material_orders WHERE order_number = 'CMD-RLS-NON-RECURSIVE-001';`
  );
  if (insertedOrderRes.rows.length !== 1) {
    throw new Error('La commande insérée sous le rôle authenticated est introuvable.');
  }

  const diagAfterPurge = await db.query(`SELECT * FROM public.diagnostic_installation();`);
  const permissiveRowAfter = diagAfterPurge.rows.find(
    (r) => r.check_key === 'permissive_rls_policies'
  );
  if (!permissiveRowAfter || permissiveRowAfter.status !== 'OK') {
    throw new Error(
      `permissive_rls_policies devait être OK après purge, reçu : ${JSON.stringify(permissiveRowAfter)}`
    );
  }
  const failingAfter = diagAfterPurge.rows.filter(
    (r) => r.status === 'KO' || r.status === 'ERREUR'
  );
  if (failingAfter.length > 0) {
    throw new Error(
      `diagnostic_installation() contient des lignes en échec après purge : ${JSON.stringify(failingAfter)}`
    );
  }

  await db.exec(`
    CREATE POLICY "Allow public access to users" ON public.core_users
      FOR ALL TO public USING (true);
  `);
  const diagWithRogueAgain = await db.query(`SELECT * FROM public.diagnostic_installation();`);
  const permissiveRogueRow = diagWithRogueAgain.rows.find(
    (r) => r.check_key === 'permissive_rls_policies'
  );
  if (
    !permissiveRogueRow ||
    permissiveRogueRow.status !== 'ERREUR' ||
    !permissiveRogueRow.details.includes('Allow public access to users')
  ) {
    throw new Error(
      `diagnostic_installation() devait renvoyer ERREUR après recréation d'une règle USING (true) pour public, reçu : ${JSON.stringify(permissiveRogueRow)}`
    );
  }
  await db.exec(`DROP POLICY IF EXISTS "Allow public access to users" ON public.core_users;`);
  results.push('9_rls_purge_parasite_and_recursive_policies_and_diagnostic_ok');

  // ---------------------------------------------------------------------------
  // TEST 10 (v39 + v42) : Base ancienne avec les ANCIENS noms de tables (users, products,
  // stock_movements avec id bigint GENERATED BY DEFAULT AS IDENTITY contenant 2 lignes,
  // movements, audit_logs, stock_levels, depots, roles, etc.)
  // -> exécution de 09_core_prefixes.sql puis 02..08 + 07 deux fois ->
  // 0 erreur, renommage complet vers core_* et stk_*, id converti en text,
  // les 2 lignes historiques ('1' et '2') sont préservées dans stk_movements,
  // les vues de compatibilité (public.products, public.stock_movements, public.users) fonctionnent,
  // diagnostic_installation() signale compat_views_present = 'ATTENTION',
  // puis 10_drop_compat_views.sql supprime les vues et compat_views_present passe à 'OK'.
  // ---------------------------------------------------------------------------
  const dbLegacy = new PGlite();
  await dbLegacy.exec(AUTH_STUB_SQL);

  // Construire une vraie base ancienne 1.x avec les anciens noms de tables non préfixés
  await dbLegacy.exec(`
    CREATE TABLE public.roles (
      id BIGINT PRIMARY KEY,
      name TEXT NOT NULL,
      permissions TEXT[] DEFAULT '{}'::text[]
    );
    INSERT INTO public.roles (id, name, permissions) VALUES
      (0, 'Super Administrateur', ARRAY['*']),
      (1, 'Administrateur', ARRAY['perm_mov_out', 'perm_stock_in', 'perm_prod_movement_direct']);

    CREATE TABLE public.departments (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT NOT NULL,
      manager_id TEXT,
      deputy_manager_ids TEXT[] DEFAULT '{}'::text[]
    );

    CREATE TABLE public.users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigram TEXT,
      email TEXT,
      pin TEXT DEFAULT '',
      role_id BIGINT DEFAULT 3,
      is_blocked BOOLEAN DEFAULT false,
      allowed_depots TEXT[] DEFAULT ARRAY['*']::text[],
      is_preparer BOOLEAN DEFAULT false,
      auth_user_id UUID
    );

    CREATE TABLE public.projects (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      project_number TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      department_id TEXT,
      manager_id TEXT,
      deputy_manager_ids TEXT[] DEFAULT '{}'::text[]
    );

    CREATE TABLE public.sub_categories (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT NOT NULL,
      category TEXT
    );

    CREATE TABLE public.depots (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT NOT NULL UNIQUE,
      type TEXT DEFAULT 'FIXED',
      is_active BOOLEAN DEFAULT true
    );
    INSERT INTO public.depots (id, name, type, is_active)
    VALUES ('depot-nord-id', 'Dépôt Nord', 'FIXED', true);

    CREATE TABLE public.products (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL,
      brand TEXT,
      model TEXT,
      store_name TEXT DEFAULT 'Dépôt Nord',
      shelf_name TEXT,
      quantity NUMERIC DEFAULT 0,
      min_stock_alert NUMERIC DEFAULT 2,
      unit_price NUMERIC DEFAULT 0
    );
    INSERT INTO public.products (id, reference, brand, model, store_name, quantity, min_stock_alert, unit_price)
    VALUES ('prod-legacy-1', 'REF-LEG-001', 'Bosch', 'Perceuse 18V', 'Dépôt Nord', 10, 2, 150);

    CREATE TABLE public.stock_movements (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
      product_ref TEXT,
      user_id TEXT,
      user_name TEXT,
      movement_type TEXT NOT NULL CHECK (movement_type IN ('IN', 'OUT')),
      quantity_changed NUMERIC(10,2) NOT NULL,
      reason TEXT,
      site_number TEXT,
      department_name TEXT,
      depot_name TEXT,
      dest_depot_name TEXT,
      total_cost NUMERIC(10,2) DEFAULT 0,
      order_number TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO public.stock_movements (product_id, product_ref, user_id, user_name, movement_type, quantity_changed, depot_name)
    VALUES
      ('prod-legacy-1', 'REF-LEG-001', 'user-leg-admin', 'Admin Legacy', 'IN', 6, 'Dépôt Nord'),
      ('prod-legacy-1', 'REF-LEG-001', 'user-leg-admin', 'Admin Legacy', 'IN', 4, 'Dépôt Nord');

    CREATE TABLE public.stock_levels (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      product_id TEXT NOT NULL,
      depot_name TEXT NOT NULL,
      quantity NUMERIC NOT NULL DEFAULT 0,
      CONSTRAINT uq_product_depot UNIQUE (product_id, depot_name)
    );
    INSERT INTO public.stock_levels (product_id, depot_name, quantity)
    VALUES ('prod-legacy-1', 'Dépôt Nord', 10);

    CREATE TABLE public.audit_logs (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id TEXT,
      user_name TEXT,
      action TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    INSERT INTO public.audit_logs (user_id, user_name, action)
    VALUES ('user-leg-admin', 'Admin Legacy', 'LEGACY_INIT');

    CREATE TABLE public.material_orders (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      order_number TEXT NOT NULL,
      requester_id TEXT,
      requester_name TEXT,
      status TEXT DEFAULT 'PENDING',
      items JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE public.app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE public.company_settings (
      id TEXT PRIMARY KEY DEFAULT 'default_company',
      company_name TEXT DEFAULT 'TOT Legacy'
    );

    CREATE TABLE public.license_config (
      id TEXT PRIMARY KEY DEFAULT 'active_license',
      plan_type TEXT DEFAULT 'free',
      max_references INT DEFAULT 50,
      max_depots INT DEFAULT 1
    );

    CREATE TABLE public.processed_operations (
      operation_id UUID PRIMARY KEY,
      user_id TEXT,
      result JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    -- Ancien déclencheur qui comptait les mouvements en double sur stock_movements
    CREATE OR REPLACE FUNCTION public.process_stock_movement()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE public.products SET quantity = COALESCE(quantity, 0) + COALESCE(NEW.quantity_changed, 0) WHERE id = NEW.product_id;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER trg_process_stock_movement
      AFTER INSERT ON public.stock_movements
      FOR EACH ROW EXECUTE FUNCTION public.process_stock_movement();
  `);

  // 10.1 Exécuter la chaîne complète de migration (09 -> 02 -> 03 -> 04 -> 05 -> 06 -> 08 -> 07) DEUX FOIS (idempotence)
  const legacyMigrationSteps = [
    '09_core_prefixes.sql',
    '02_rls_hardening.sql',
    '03_rpc_stock_and_orders.sql',
    '04_mouvements_et_depots_vehicules.sql',
    '05_rpc_admin_users.sql',
    '06_install_additional_roles.sql',
    '08_print_jobs.sql',
    '11_suite_tables.sql',
    '12_user_preferences.sql',
    '07_app_compat.sql',
  ];

  for (let pass = 1; pass <= 2; pass += 1) {
    for (const s of legacyMigrationSteps) {
      await dbLegacy.exec(readClientScript(s));
    }
  }

  // 10.2 Vérifier que stk_movements.id, core_audit_logs.id et stk_stock_levels.id sont de type 'text' et is_identity = 'NO'
  for (const tName of ['stk_movements', 'core_audit_logs', 'stk_stock_levels']) {
    const colAfterConv = await dbLegacy.query(
      `SELECT data_type, is_identity
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'id';`,
      [tName]
    );
    if (colAfterConv.rows[0]?.data_type !== 'text' || colAfterConv.rows[0]?.is_identity !== 'NO') {
      throw new Error(
        `${tName}.id devait être converti en text (is_identity=NO), reçu : ${JSON.stringify(colAfterConv.rows[0])}`
      );
    }
  }

  // 10.3 Vérifier la présence de la colonne app DEFAULT 'stock' sur core_audit_logs et core_processed_operations
  for (const tName of ['core_audit_logs', 'core_processed_operations']) {
    const appCol = await dbLegacy.query(
      `SELECT column_name, data_type, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'app';`,
      [tName]
    );
    if (appCol.rows.length !== 1 || !String(appCol.rows[0].column_default || '').includes('stock')) {
      throw new Error(
        `La colonne app DEFAULT 'stock' est absente sur ${tName} : ${JSON.stringify(appCol.rows)}`
      );
    }
  }

  // 10.4 Vérifier que les 2 lignes historiques sont conservées dans stk_movements avec les ids '1' et '2'
  const preservedRows = await dbLegacy.query(`
    SELECT id, product_id, quantity_changed
    FROM public.stk_movements
    ORDER BY id ASC;
  `);
  if (
    preservedRows.rows.length !== 2 ||
    preservedRows.rows[0].id !== '1' ||
    preservedRows.rows[1].id !== '2'
  ) {
    throw new Error(
      `Les 2 lignes historiques de stk_movements ('1' et '2') devaient être conservées, reçu : ${JSON.stringify(preservedRows.rows)}`
    );
  }

  // 10.5 Exécuter un process_stock_movement ultérieur et vérifier qu'il insère dans stk_movements, core_audit_logs (app='stock') et core_processed_operations (app='stock')
  const UUID_LEG_ADMIN = '00000000-0000-4000-8000-000000000199';
  await dbLegacy.exec(`
    INSERT INTO auth.users (id, email)
    VALUES ('${UUID_LEG_ADMIN}', 'legadmin@test.local')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.core_users (id, name, trigram, email, pin, role_id, is_blocked, allowed_depots, is_preparer, auth_user_id)
    VALUES ('user-leg-admin', 'Admin Legacy', 'ADM', 'legadmin@test.local', '', 0, false, ARRAY['*']::text[], true, '${UUID_LEG_ADMIN}')
    ON CONFLICT (id) DO UPDATE SET role_id = 0, auth_user_id = EXCLUDED.auth_user_id, is_blocked = false;

    SELECT set_config('request.jwt.claim.sub', '${UUID_LEG_ADMIN}', false);
  `);

  const moveRes = await dbLegacy.query(`
    SELECT public.process_stock_movement(
      '11111111-2222-4333-8444-555555555555'::uuid,
      'prod-legacy-1',
      'Dépôt Nord',
      'IN',
      5,
      'Réappro test v42',
      NULL,
      'Logistique',
      NULL,
      NULL,
      '{}'::jsonb,
      'STOCK_DIRECT_MOVE'
    ) AS res;
  `);
  if (!moveRes.rows[0]?.res || Number(moveRes.rows[0].res.new_quantity) !== 15) {
    throw new Error(`process_stock_movement a échoué après renommage v42 : ${JSON.stringify(moveRes.rows[0])}`);
  }

  // Vérifier que les vues de compatibilité (public.products, public.stock_movements, public.movements, public.users) fonctionnent en lecture/écriture pour authenticated et sont interdites à anon
  const viaCompatViewProducts = await dbLegacy.query(
    `SELECT id, quantity FROM public.products WHERE id = 'prod-legacy-1';`
  );
  if (Number(viaCompatViewProducts.rows[0]?.quantity) !== 15) {
    throw new Error(
      `La vue de compatibilité public.products devait refléter quantity=15, reçu : ${JSON.stringify(viaCompatViewProducts.rows)}`
    );
  }
  const viaCompatViewMovs = await dbLegacy.query(
    `SELECT count(*)::int AS cnt FROM public.stock_movements WHERE product_id = 'prod-legacy-1';`
  );
  if (viaCompatViewMovs.rows[0]?.cnt !== 3) {
    throw new Error(
      `La vue de compatibilité public.stock_movements devait compter 3 lignes, reçu : ${JSON.stringify(viaCompatViewMovs.rows)}`
    );
  }

  // Vérifier qu'anon n'a aucun droit sur la vue de compatibilité public.users ni public.products
  await expectSqlFailure(
    () =>
      dbLegacy.exec(`
        BEGIN;
        SET LOCAL ROLE anon;
        SELECT count(*) FROM public.users;
        COMMIT;
      `),
    'permission denied'
  );
  await dbLegacy.exec(`ROLLBACK;`);

  // 10.6 Vérifier diagnostic_installation() sur la base migrée : prefixed_tables = OK, compat_views_present = ATTENTION
  const diagLegacyWithViews = await dbLegacy.query(`SELECT * FROM public.diagnostic_installation();`);
  const legPrefixedRow = diagLegacyWithViews.rows.find((r) => r.check_key === 'prefixed_tables');
  const legCompatViewsRow = diagLegacyWithViews.rows.find((r) => r.check_key === 'compat_views_present');
  if (legPrefixedRow?.status !== 'OK') {
    throw new Error(`Sur base migrée, prefixed_tables devait être OK : ${JSON.stringify(legPrefixedRow)}`);
  }
  if (legCompatViewsRow?.status !== 'ATTENTION') {
    throw new Error(
      `Sur base migrée avec vues de compatibilité, compat_views_present devait être ATTENTION : ${JSON.stringify(legCompatViewsRow)}`
    );
  }

  // 10.7 Exécuter 10_drop_compat_views.sql -> supprime les vues de compatibilité sans toucher aux tables physiques core_* / stk_*
  await dbLegacy.exec(readClientScript('10_drop_compat_views.sql'));
  const viewsAfterDrop = await dbLegacy.query(`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v';
  `);
  if (viewsAfterDrop.rows.length !== 0) {
    throw new Error(
      `Après 10_drop_compat_views.sql, aucune vue de compatibilité ne devait subsister : ${JSON.stringify(viewsAfterDrop.rows)}`
    );
  }

  const diagLegacyAfterDropViews = await dbLegacy.query(`SELECT * FROM public.diagnostic_installation();`);
  const legCompatViewsAfterDrop = diagLegacyAfterDropViews.rows.find(
    (r) => r.check_key === 'compat_views_present'
  );
  if (legCompatViewsAfterDrop?.status !== 'OK') {
    throw new Error(
      `Après 10_drop_compat_views.sql, compat_views_present devait passer à OK : ${JSON.stringify(legCompatViewsAfterDrop)}`
    );
  }
  const rowsStillIntact = await dbLegacy.query(`SELECT id FROM public.stk_movements;`);
  if (rowsStillIntact.rows.length !== 3) {
    throw new Error('10_drop_compat_views.sql ne devait altérer aucune table physique stk_movements.');
  }

  await dbLegacy.close();
  results.push('10_legacy_db_rename_compat_views_and_drop_views_ok');

  // ---------------------------------------------------------------------------
  // TEST 11 (LOT 1 v40) : Test de bout en bout SQL — process_stock_movement IN puis OUT
  // par un utilisateur authentifié → stk_movements, stk_stock_levels et stk_products.quantity cohérents
  // + Contrôle diagnostic_installation() 'stock_movements_rpc'
  // ---------------------------------------------------------------------------
  await setAuthUser(UUID_ADMIN);
  await db.exec(`
    INSERT INTO public.stk_depots (id, name, type, is_active)
    VALUES ('dep-lot1-main', 'Magasin Central', 'FIXED', true)
    ON CONFLICT (name) DO UPDATE SET is_active = true;

    INSERT INTO public.stk_products (id, reference, brand, model, quantity, min_stock_alert, unit_price, store_name)
    VALUES ('prod-lot1-e2e', 'REF-LOT1-E2E', 'Hilti', 'Perfo TE-30', 0, 2, 420, 'Magasin Central')
    ON CONFLICT (id) DO UPDATE SET quantity = 0, store_name = 'Magasin Central';

    DELETE FROM public.stk_stock_levels WHERE product_id = 'prod-lot1-e2e';
    DELETE FROM public.stk_movements WHERE product_id = 'prod-lot1-e2e';
  `);

  const inRpc = await db.query(`
    SELECT public.process_stock_movement(
      'aaaaaaaa-1111-4000-8000-000000000001'::uuid,
      'prod-lot1-e2e',
      'Magasin Central',
      'IN',
      12,
      'Réception commande fournisseur',
      NULL,
      'Logistique',
      NULL,
      'RACK-A1',
      '{"product_ref":"REF-LOT1-E2E","min_alert":3}'::jsonb,
      'IN'
    ) AS res;
  `);
  const inJson = inRpc.rows[0]?.res;
  if (!inJson || inJson.success !== true || Number(inJson.new_quantity) !== 12 || Number(inJson.depot_quantity) !== 12) {
    throw new Error(`LOT 1 E2E IN inattendu : ${JSON.stringify(inJson)}`);
  }

  const outRpc = await db.query(`
    SELECT public.process_stock_movement(
      'aaaaaaaa-1111-4000-8000-000000000002'::uuid,
      'prod-lot1-e2e',
      'Magasin Central',
      'OUT',
      5,
      'Sortie chantier CH-100',
      'CH-100',
      'Électricité',
      NULL,
      NULL,
      '{"product_ref":"REF-LOT1-E2E"}'::jsonb,
      'OUT'
    ) AS res;
  `);
  const outJson = outRpc.rows[0]?.res;
  if (!outJson || outJson.success !== true || Number(outJson.new_quantity) !== 7 || Number(outJson.depot_quantity) !== 7) {
    throw new Error(`LOT 1 E2E OUT inattendu : ${JSON.stringify(outJson)}`);
  }

  const e2eMovs = await db.query(
    `SELECT movement_type, quantity_changed, depot_name FROM public.stk_movements WHERE product_id = 'prod-lot1-e2e' ORDER BY created_at ASC;`
  );
  if (e2eMovs.rows.length !== 2) {
    throw new Error(`Attendu 2 lignes dans stk_movements pour prod-lot1-e2e, reçu ${e2eMovs.rows.length}`);
  }
  const e2eLevel = await db.query(
    `SELECT quantity, rack_location, min_alert FROM public.stk_stock_levels WHERE product_id = 'prod-lot1-e2e' AND depot_name = 'Magasin Central';`
  );
  if (Number(e2eLevel.rows[0]?.quantity) !== 7 || e2eLevel.rows[0]?.rack_location !== 'RACK-A1') {
    throw new Error(`stk_stock_levels incohérent après IN+OUT : ${JSON.stringify(e2eLevel.rows[0])}`);
  }
  const e2eProd = await db.query(`SELECT quantity FROM public.stk_products WHERE id = 'prod-lot1-e2e';`);
  if (Number(e2eProd.rows[0]?.quantity) !== 7) {
    throw new Error(`stk_products.quantity incohérent après IN+OUT : ${JSON.stringify(e2eProd.rows[0])}`);
  }

  const diagCheck = await db.query(
    `SELECT check_key, status, details FROM public.diagnostic_installation() WHERE check_key = 'stock_movements_rpc';`
  );
  if (diagCheck.rows.length !== 1 || diagCheck.rows[0].status !== 'OK') {
    throw new Error(`Le contrôle stock_movements_rpc de diagnostic_installation() devait être OK : ${JSON.stringify(diagCheck.rows)}`);
  }
  results.push('11_lot1_e2e_in_out_and_diagnostic_ok');

  // ---------------------------------------------------------------------------
  // TEST 12 (LOT 2 v40) : Une même référence dans 3 dépôts (10, 4 et 0 unités)
  // ---------------------------------------------------------------------------
  await setAuthUser(UUID_ADMIN);
  await db.exec(`
    UPDATE public.core_license_config
    SET
      plan_type = 'pro',
      max_depots = 10,
      signed_token = '{"plan":"pro","max_depots":10,"max_references":1000,"signature":"ed25519_valid_sig_lot2_test"}'
    WHERE id = 'active_license';

    INSERT INTO public.stk_depots (id, name, type, is_active) VALUES
      ('dep-lot2-a', 'Dépôt A', 'FIXED', true),
      ('dep-lot2-b', 'Dépôt B', 'FIXED', true),
      ('dep-lot2-c', 'Dépôt C', 'VEHICLE', true)
    ON CONFLICT (name) DO UPDATE SET is_active = true;

    INSERT INTO public.stk_products (id, reference, brand, model, quantity, min_stock_alert, unit_price, store_name, shelf_name)
    VALUES ('prod-lot2-multi', 'REF-LOT2-MULTI', 'Legrand', 'Disjoncteur DNX3 16A', 0, 2, 18.5, 'Dépôt A', 'A-01')
    ON CONFLICT (id) DO UPDATE SET quantity = 0, store_name = 'Dépôt A', shelf_name = 'A-01';

    DELETE FROM public.stk_stock_levels WHERE product_id = 'prod-lot2-multi';
    DELETE FROM public.stk_movements WHERE product_id = 'prod-lot2-multi';
  `);

  await db.query(`
    SELECT public.process_stock_movement(
      'bbbbbbbb-2222-4000-8000-000000000001'::uuid,
      'prod-lot2-multi', 'Dépôt A', 'IN', 10,
      'Dotation initiale Dépôt A', NULL, 'Logistique', NULL, 'RACK-A01',
      '{"product_ref":"REF-LOT2-MULTI","min_alert":3}'::jsonb, 'IN'
    );
  `);
  await db.query(`
    SELECT public.process_stock_movement(
      'bbbbbbbb-2222-4000-8000-000000000002'::uuid,
      'prod-lot2-multi', 'Dépôt B', 'IN', 4,
      'Dotation initiale Dépôt B', NULL, 'Logistique', NULL, 'RACK-B02',
      '{"product_ref":"REF-LOT2-MULTI","min_alert":2}'::jsonb, 'IN'
    );
  `);
  await db.query(`
    SELECT public.process_stock_movement(
      'bbbbbbbb-2222-4000-8000-000000000003'::uuid,
      'prod-lot2-multi', 'Dépôt C', 'INVENTORY', 0,
      'Initialisation à 0 Dépôt C', NULL, 'Logistique', NULL, 'VAN-C1',
      '{"product_ref":"REF-LOT2-MULTI","min_alert":1}'::jsonb, 'INVENTORY'
    );
  `);

  const lot2InitialLevels = await db.query(
    `SELECT depot_name, quantity, rack_location, min_alert FROM public.stk_stock_levels WHERE product_id = 'prod-lot2-multi' ORDER BY depot_name ASC;`
  );
  if (
    lot2InitialLevels.rows.length !== 3 ||
    Number(lot2InitialLevels.rows[0].quantity) !== 10 ||
    Number(lot2InitialLevels.rows[1].quantity) !== 4 ||
    Number(lot2InitialLevels.rows[2].quantity) !== 0
  ) {
    throw new Error(`LOT 2 stk_stock_levels initiaux inattendus : ${JSON.stringify(lot2InitialLevels.rows)}`);
  }
  const lot2InitialProd = await db.query(`SELECT quantity FROM public.stk_products WHERE id = 'prod-lot2-multi';`);
  if (Number(lot2InitialProd.rows[0]?.quantity) !== 14) {
    throw new Error(`LOT 2 stk_products.quantity initial attendu = 14, reçu ${lot2InitialProd.rows[0]?.quantity}`);
  }

  const outDepotB = await db.query(`
    SELECT public.process_stock_movement(
      'bbbbbbbb-2222-4000-8000-000000000004'::uuid,
      'prod-lot2-multi', 'Dépôt B', 'OUT', 3,
      'Sortie chantier depuis Dépôt B', 'CH-200', 'Électricité', NULL, NULL,
      '{"product_ref":"REF-LOT2-MULTI"}'::jsonb, 'OUT'
    ) AS res;
  `);
  const outBJson = outDepotB.rows[0]?.res;
  if (!outBJson || Number(outBJson.depot_quantity) !== 1 || Number(outBJson.new_quantity) !== 11) {
    throw new Error(`LOT 2 OUT Dépôt B inattendu : ${JSON.stringify(outBJson)}`);
  }

  let outBRejected = false;
  try {
    await db.query(`
      SELECT public.process_stock_movement(
        'bbbbbbbb-2222-4000-8000-000000000005'::uuid,
        'prod-lot2-multi', 'Dépôt B', 'OUT', 5,
        'Tentative sortie excessive Dépôt B', 'CH-200', 'Électricité', NULL, NULL,
        '{"product_ref":"REF-LOT2-MULTI"}'::jsonb, 'OUT'
      );
    `);
  } catch (err) {
    if (String(err.message || err).includes('Stock insuffisant')) {
      outBRejected = true;
    } else {
      throw err;
    }
  }
  if (!outBRejected) {
    throw new Error('LOT 2 : la sortie de 5 dans le Dépôt B (stock=1) aurait dû être refusée.');
  }

  const transferAC = await db.query(`
    SELECT public.process_stock_movement(
      'bbbbbbbb-2222-4000-8000-000000000006'::uuid,
      'prod-lot2-multi', 'Dépôt A', 'TRANSFER', 4,
      'Réappro véhicule C depuis Dépôt A', NULL, 'Logistique', 'Dépôt C', 'VAN-C1-BAC2',
      '{"product_ref":"REF-LOT2-MULTI"}'::jsonb, 'TRANSFER'
    ) AS res;
  `);
  const transferJson = transferAC.rows[0]?.res;
  if (
    !transferJson ||
    Number(transferJson.depot_quantity) !== 6 ||
    Number(transferJson.dest_depot_quantity) !== 4 ||
    Number(transferJson.new_quantity) !== 11
  ) {
    throw new Error(`LOT 2 TRANSFER A -> C inattendu : ${JSON.stringify(transferJson)}`);
  }
  results.push('12_lot2_multi_depot_exact_stock_and_transfer_ok');

  // ---------------------------------------------------------------------------
  // TEST 13 (LOT 3 v40) : Un audit (mouvement INVENTORY) sur le Dépôt B
  // met à jour uniquement le Dépôt B et stk_products.quantity
  // ---------------------------------------------------------------------------
  const auditDepotB = await db.query(`
    SELECT public.process_stock_movement(
      'cccccccc-3333-4000-8000-000000000001'::uuid,
      'prod-lot2-multi', 'Dépôt B', 'INVENTORY', 9,
      'Régularisation Inventaire Physique TOT (Audit Dépôt B)', 'INV-REGUL', 'Régularisation Inventaire', NULL, NULL,
      '{"product_ref":"REF-LOT2-MULTI","audit_id":"audit-lot3-b"}'::jsonb, 'INVENTORY_AUDIT'
    ) AS res;
  `);
  const auditBJson = auditDepotB.rows[0]?.res;
  if (!auditBJson || Number(auditBJson.depot_quantity) !== 9 || Number(auditBJson.new_quantity) !== 19) {
    throw new Error(`LOT 3 INVENTORY Dépôt B inattendu : ${JSON.stringify(auditBJson)}`);
  }

  const levelsAfterAuditB = await db.query(
    `SELECT depot_name, quantity FROM public.stk_stock_levels WHERE product_id = 'prod-lot2-multi' ORDER BY depot_name ASC;`
  );
  if (
    Number(levelsAfterAuditB.rows[0].quantity) !== 6 ||
    Number(levelsAfterAuditB.rows[1].quantity) !== 9 ||
    Number(levelsAfterAuditB.rows[2].quantity) !== 4
  ) {
    throw new Error(
      `LOT 3 : l'audit sur le Dépôt B ne devait modifier ni A (6) ni C (4), reçu : ${JSON.stringify(levelsAfterAuditB.rows)}`
    );
  }
  const prodAfterAuditB = await db.query(`SELECT quantity FROM public.stk_products WHERE id = 'prod-lot2-multi';`);
  if (Number(prodAfterAuditB.rows[0]?.quantity) !== 19) {
    throw new Error(`LOT 3 : stk_products.quantity attendu = 19 après audit Dépôt B, reçu ${prodAfterAuditB.rows[0]?.quantity}`);
  }
  results.push('13_lot3_inventory_audit_depot_b_isolated_ok');

  // ---------------------------------------------------------------------------
  // TEST 14 (B1 v41) : Base existante avec colonnes manquantes
  // ---------------------------------------------------------------------------
  await db.exec(`
    ALTER TABLE public.stk_products DROP COLUMN IF EXISTS updated_at CASCADE;
    ALTER TABLE public.stk_stock_levels DROP COLUMN IF EXISTS updated_at CASCADE;
    ALTER TABLE public.stk_stock_levels DROP COLUMN IF EXISTS rack_location CASCADE;
    ALTER TABLE public.stk_depots DROP COLUMN IF EXISTS phone CASCADE;
  `);

  const replayScripts02To08 = [
    '02_rls_hardening.sql',
    '03_rpc_stock_and_orders.sql',
    '04_mouvements_et_depots_vehicules.sql',
    '05_rpc_admin_users.sql',
    '06_install_additional_roles.sql',
    '08_print_jobs.sql',
    '11_suite_tables.sql',
    '12_user_preferences.sql',
    '07_app_compat.sql',
  ];

  for (let pass = 1; pass <= 2; pass += 1) {
    for (const s of replayScripts02To08) {
      await db.exec(readClientScript(s));
    }
  }

  const recreatedCols = await db.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'stk_products' AND column_name = 'updated_at')
        OR (table_name = 'stk_stock_levels' AND column_name IN ('updated_at', 'rack_location'))
        OR (table_name = 'stk_depots' AND column_name = 'phone')
      )
    ORDER BY table_name ASC, column_name ASC;
  `);
  if (recreatedCols.rows.length !== 4) {
    throw new Error(
      `B1 v41 : les 4 colonnes supprimées devaient être recréées par 02..08, reçu : ${JSON.stringify(recreatedCols.rows)}`
    );
  }
  results.push('14_v41_missing_columns_recreated_and_idempotent_ok');

  // ---------------------------------------------------------------------------
  // TEST 15 (B2 v41) : Déclencheurs hérités qui comptent les mouvements en double
  // ---------------------------------------------------------------------------
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.process_stock_movement()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      UPDATE public.stk_products
      SET quantity = COALESCE(quantity, 0) + COALESCE(NEW.quantity_changed, 0)
      WHERE id = NEW.product_id;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER trg_process_stock_movement
      AFTER INSERT ON public.stk_movements
      FOR EACH ROW
      EXECUTE FUNCTION public.process_stock_movement();

    CREATE OR REPLACE FUNCTION public.fn_legacy_custom_double_count()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      UPDATE public.stk_products
      SET quantity = COALESCE(quantity, 0) + COALESCE(NEW.quantity_changed, 0)
      WHERE id = NEW.product_id;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER trg_legacy_custom_double_count
      AFTER INSERT ON public.stk_movements
      FOR EACH ROW
      EXECUTE FUNCTION public.fn_legacy_custom_double_count();
  `);

  const diagBeforeTriggerPurge = await db.query(
    `SELECT check_key, status, details FROM public.diagnostic_installation() WHERE check_key = 'unknown_stock_triggers';`
  );
  if (
    diagBeforeTriggerPurge.rows.length !== 1 ||
    diagBeforeTriggerPurge.rows[0].status !== 'ERREUR' ||
    !diagBeforeTriggerPurge.rows[0].details.includes('trg_process_stock_movement') ||
    !diagBeforeTriggerPurge.rows[0].details.includes('trg_legacy_custom_double_count')
  ) {
    throw new Error(
      `B2 v41 : diagnostic_installation() devait signaler ERREUR sur unknown_stock_triggers avant purge : ${JSON.stringify(diagBeforeTriggerPurge.rows)}`
    );
  }

  for (const s of replayScripts02To08) {
    await db.exec(readClientScript(s));
  }

  const diagAfterTriggerPurge = await db.query(
    `SELECT check_key, status, details FROM public.diagnostic_installation() WHERE check_key IN ('unknown_stock_triggers', 'stock_consistency');`
  );
  for (const row of diagAfterTriggerPurge.rows) {
    if (row.status !== 'OK') {
      throw new Error(
        `B2 v41 : le contrôle ${row.check_key} devait être OK après purge des déclencheurs hérités, reçu : ${JSON.stringify(row)}`
      );
    }
  }

  await setAuthUser(UUID_ADMIN);
  const qtyBeforeIn1 = await db.query(
    `SELECT quantity FROM public.stk_products WHERE id = 'prod-lot1-e2e';`
  );
  const startQty = Number(qtyBeforeIn1.rows[0]?.quantity ?? 0);

  await db.query(`
    SELECT public.process_stock_movement(
      'eeeeeeee-5555-4000-8000-000000000001'::uuid,
      'prod-lot1-e2e',
      'Magasin Central',
      'IN',
      1,
      'Vérification absence double comptage B2 v41',
      NULL,
      'Logistique',
      NULL,
      NULL,
      '{"product_ref":"REF-LOT1-E2E"}'::jsonb,
      'IN'
    );
  `);

  const qtyAfterIn1 = await db.query(
    `SELECT quantity FROM public.stk_products WHERE id = 'prod-lot1-e2e';`
  );
  const endQty = Number(qtyAfterIn1.rows[0]?.quantity ?? 0);
  if (endQty !== startQty + 1) {
    throw new Error(
      `B2 v41 : après un mouvement IN de 1, stk_products.quantity devait augmenter de 1 (${startQty} -> ${startQty + 1}), reçu ${endQty}`
    );
  }
  results.push('15_v41_legacy_double_count_triggers_purged_ok');

  // ---------------------------------------------------------------------------
  // TEST 16 (LOT 4 v43) : Historique des audits (stk_inventory_audits & stk_inventory_audit_items)
  // - Admin (rôle 0) et utilisateur avec perm_menu_inventory_audit / perm_inventory_validate écrivent et lisent
  // - anon refusé (zéro droit)
  // - Opérateur sans perm_menu_inventory_audit ni perm_inventory_validate ne lit pas et n'écrit pas
  // - UPDATE / DELETE réservés au rôle 0
  // - Diagnostic tables_without_rls_policies détecte une table avec RLS activé et 0 règle
  // - fix_inventory_audits.sql rejouable 2 fois
  // ---------------------------------------------------------------------------
  const UUID_AUDITOR = '00000000-0000-4000-8000-000000000050';
  await db.exec(`
    INSERT INTO public.core_roles (id, name, permissions)
    VALUES (30, 'Role Auditeur', ARRAY['perm_menu_inventory_audit']::text[])
    ON CONFLICT (id) DO UPDATE SET permissions = EXCLUDED.permissions;

    INSERT INTO auth.users (id, email)
    VALUES ('${UUID_AUDITOR}', 'auditor@test.local')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.core_users (id, name, email, pin, role_id, is_blocked, allowed_depots, is_preparer, auth_user_id)
    VALUES ('user-auditor', 'Auditeur Stock', 'auditor@test.local', '', 30, false, ARRAY['Dépôt Nord']::text[], false, '${UUID_AUDITOR}')
    ON CONFLICT (id) DO UPDATE SET role_id = 30, auth_user_id = EXCLUDED.auth_user_id, is_blocked = false;
  `);

  // 16.1 Admin (rôle 0) écrit et lit dans stk_inventory_audits et stk_inventory_audit_items
  await db.exec(`
    BEGIN;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${UUID_ADMIN}', true);
    SELECT set_config('request.jwt.claim.role', 'authenticated', true);

    INSERT INTO public.stk_inventory_audits (
      id, depot_name, auditor_id, auditor_name, status, items_counted, items_with_diff, total_diff_cost
    ) VALUES (
      'AUD-V43-ADMIN-1', 'Magasin Central', 'user-admin', 'Super Admin', 'COMPLETED', 2, 1, -18.5
    );

    INSERT INTO public.stk_inventory_audit_items (
      id, audit_id, product_id, product_ref, product_name, theoretical_qty, physical_count, difference, unit_price, diff_cost
    ) VALUES (
      'AUD-V43-ADMIN-1-IT1', 'AUD-V43-ADMIN-1', 'prod-lot1-e2e', 'REF-LOT1-E2E', 'Perfo TE-30', 10, 9, -1, 18.5, -18.5
    );
    COMMIT;
  `);

  // 16.2 Utilisateur avec perm_menu_inventory_audit lit l'audit et peut en insérer un, mais ne peut ni UPDATE ni DELETE
  await db.exec(`
    BEGIN;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${UUID_AUDITOR}', true);
    SELECT set_config('request.jwt.claim.role', 'authenticated', true);

    INSERT INTO public.stk_inventory_audits (
      id, depot_name, auditor_id, auditor_name, status, items_counted, items_with_diff, total_diff_cost
    ) VALUES (
      'AUD-V43-AUDITOR-1', 'Dépôt Nord', 'user-auditor', 'Auditeur Stock', 'COMPLETED', 1, 0, 0
    );
    COMMIT;
  `);

  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${UUID_AUDITOR}', false);
    SELECT set_config('request.jwt.claim.role', 'authenticated', false);
  `);
  const auditorReadRes = await db.query(
    `SELECT id FROM public.stk_inventory_audits ORDER BY id ASC;`
  );
  if (auditorReadRes.rows.length !== 2) {
    throw new Error(
      `L'auditeur avec perm_menu_inventory_audit devait lire les 2 audits, reçu : ${JSON.stringify(auditorReadRes.rows)}`
    );
  }
  const auditorDelRes = await db.query(
    `DELETE FROM public.stk_inventory_audits WHERE id = 'AUD-V43-ADMIN-1' RETURNING id;`
  );
  if (auditorDelRes.rows.length !== 0) {
    throw new Error(`Un auditeur non rôle 0 ne doit pas pouvoir supprimer un audit.`);
  }
  await db.exec(`RESET ROLE;`);

  // 16.3 Opérateur sans droit (UUID_NO_PERM : n'a que perm_inventory_view) ne lit rien (0 ligne) et ne peut pas insérer
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${UUID_NO_PERM}', false);
    SELECT set_config('request.jwt.claim.role', 'authenticated', false);
  `);
  const noPermReadAudits = await db.query(`SELECT id FROM public.stk_inventory_audits;`);
  const noPermReadItems = await db.query(`SELECT id FROM public.stk_inventory_audit_items;`);
  if (noPermReadAudits.rows.length !== 0 || noPermReadItems.rows.length !== 0) {
    throw new Error(
      `Un opérateur sans perm_menu_inventory_audit ni perm_inventory_validate ne doit lire aucun audit, reçu : ${noPermReadAudits.rows.length} audits, ${noPermReadItems.rows.length} items`
    );
  }
  await expectSqlFailure(
    () =>
      db.query(`
        INSERT INTO public.stk_inventory_audits (id, depot_name, auditor_id, auditor_name, status)
        VALUES ('AUD-FORBIDDEN', 'Dépôt Nord', 'user-no-perm', 'Sans Droit', 'COMPLETED');
      `),
    'row-level security'
  );
  await db.exec(`RESET ROLE;`);

  // 16.4 anon refusé sur stk_inventory_audits et stk_inventory_audit_items
  await expectSqlFailure(
    () =>
      db.exec(`
        BEGIN;
        SET LOCAL ROLE anon;
        SELECT count(*) FROM public.stk_inventory_audits;
        COMMIT;
      `),
    'permission denied'
  );
  await db.exec(`ROLLBACK;`);

  await expectSqlFailure(
    () =>
      db.exec(`
        BEGIN;
        SET LOCAL ROLE anon;
        SELECT count(*) FROM public.stk_inventory_audit_items;
        COMMIT;
      `),
    'permission denied'
  );
  await db.exec(`ROLLBACK;`);

  // 16.5 Contrôle diagnostic tables_without_rls_policies (« Tables sans règle d'accès »)
  await setAuthUser(UUID_ADMIN);
  const diagBeforeDropAuditPol = await db.query(
    `SELECT check_key, check_label, status, details FROM public.diagnostic_installation() WHERE check_key = 'tables_without_rls_policies';`
  );
  if (diagBeforeDropAuditPol.rows[0]?.status !== 'OK') {
    throw new Error(
      `tables_without_rls_policies devait être OK, reçu : ${JSON.stringify(diagBeforeDropAuditPol.rows[0])}`
    );
  }

  // Supprimer les politiques de stk_inventory_audits pour simuler une table avec RLS activé et 0 règle
  await db.exec(`
    DROP POLICY IF EXISTS "Authenticated read stk_inventory_audits" ON public.stk_inventory_audits;
    DROP POLICY IF EXISTS "Authenticated insert stk_inventory_audits" ON public.stk_inventory_audits;
    DROP POLICY IF EXISTS "SuperAdmin update stk_inventory_audits" ON public.stk_inventory_audits;
    DROP POLICY IF EXISTS "SuperAdmin delete stk_inventory_audits" ON public.stk_inventory_audits;
  `);

  const diagWithoutAuditPol = await db.query(
    `SELECT check_key, check_label, status, details FROM public.diagnostic_installation() WHERE check_key = 'tables_without_rls_policies';`
  );
  if (
    diagWithoutAuditPol.rows[0]?.status !== 'ERREUR' ||
    !String(diagWithoutAuditPol.rows[0]?.details || '').includes('stk_inventory_audits')
  ) {
    throw new Error(
      `tables_without_rls_policies devait signaler ERREUR sur stk_inventory_audits quand 0 règle RLS : ${JSON.stringify(diagWithoutAuditPol.rows[0])}`
    );
  }

  // Rejouer fix_inventory_audits.sql deux fois d'affilée (idempotent) -> rétablit les règles RLS
  await db.exec(readClientScript('fix_inventory_audits.sql'));
  await db.exec(readClientScript('fix_inventory_audits.sql'));

  const diagAfterFixAudit = await db.query(
    `SELECT check_key, check_label, status, details FROM public.diagnostic_installation() WHERE check_key = 'tables_without_rls_policies';`
  );
  if (diagAfterFixAudit.rows[0]?.status !== 'OK') {
    throw new Error(
      `Après fix_inventory_audits.sql, tables_without_rls_policies devait repasser à OK : ${JSON.stringify(diagAfterFixAudit.rows[0])}`
    );
  }
  results.push('16_v43_inventory_audits_rls_and_tables_without_policies_ok');

  await db.close();
  return results;
}

export async function runLegacySchemaSqlTests() {
  const results = [];
  const installScripts = [
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
    '07_app_compat.sql',
  ];

  // ---------------------------------------------------------------------------
  // (a) Table héritée `categories` avec `id text` sans séquence (rejeu 2 fois, données conservées)
  // ---------------------------------------------------------------------------
  const dbCatText = new PGlite();
  await dbCatText.exec(AUTH_STUB_SQL);
  await dbCatText.exec(`
    CREATE TABLE public.categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    INSERT INTO public.categories (id, name)
    VALUES ('cat-legacy-txt-1', 'Outillage Manuel');

    CREATE TABLE public.sub_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT
    );
    INSERT INTO public.sub_categories (id, name, category)
    VALUES ('sub-legacy-1', 'Tournevis Isolés', 'Électricité');
  `);

  for (let pass = 1; pass <= 2; pass += 1) {
    for (const s of installScripts) {
      await dbCatText.exec(readClientScript(s));
    }
  }

  const catTextRows = await dbCatText.query(
    `SELECT id, name FROM public.stk_categories ORDER BY name ASC;`
  );
  const catTextNames = catTextRows.rows.map((r) => r.name);
  if (!catTextNames.includes('Outillage Manuel') || !catTextNames.includes('Électricité')) {
    throw new Error(
      `(a) categories id text : données attendues ['Électricité', 'Outillage Manuel'], reçu ${JSON.stringify(catTextRows.rows)}`
    );
  }
  const preservedTxtRow = catTextRows.rows.find((r) => r.name === 'Outillage Manuel');
  if (preservedTxtRow?.id !== 'cat-legacy-txt-1') {
    throw new Error(
      `(a) categories id text : l'identifiant historique 'cat-legacy-txt-1' devait être conservé, reçu ${JSON.stringify(preservedTxtRow)}`
    );
  }
  await dbCatText.close();
  results.push('v44_lot1_a_legacy_categories_id_text_no_seq_two_passes_ok');

  // ---------------------------------------------------------------------------
  // (b) Table héritée `categories` avec `bigserial` (séquence sous l'ancien nom categories_id_seq)
  // ---------------------------------------------------------------------------
  const dbCatBigserial = new PGlite();
  await dbCatBigserial.exec(AUTH_STUB_SQL);
  await dbCatBigserial.exec(`
    CREATE TABLE public.categories (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
    INSERT INTO public.categories (name) VALUES ('Plomberie'), ('CVC');
  `);

  for (let pass = 1; pass <= 2; pass += 1) {
    for (const s of installScripts) {
      await dbCatBigserial.exec(readClientScript(s));
    }
  }

  const catSerialRows = await dbCatBigserial.query(
    `SELECT id, name FROM public.stk_categories ORDER BY id ASC;`
  );
  if (
    catSerialRows.rows.length < 2 ||
    catSerialRows.rows[0].name !== 'Plomberie' ||
    catSerialRows.rows[1].name !== 'CVC'
  ) {
    throw new Error(
      `(b) categories bigserial : données non conservées : ${JSON.stringify(catSerialRows.rows)}`
    );
  }
  const seqPrivRes = await dbCatBigserial.query(`
    SELECT pg_get_serial_sequence('public.stk_categories', 'id') AS seq_name,
           has_sequence_privilege('authenticated', pg_get_serial_sequence('public.stk_categories', 'id'), 'USAGE, SELECT') AS auth_has_priv;
  `);
  if (!seqPrivRes.rows[0]?.seq_name || seqPrivRes.rows[0]?.auth_has_priv !== true) {
    throw new Error(
      `(b) categories bigserial : droits séquence manquants pour authenticated : ${JSON.stringify(seqPrivRes.rows[0])}`
    );
  }
  await dbCatBigserial.close();
  results.push('v44_lot1_b_legacy_categories_bigserial_two_passes_ok');

  // ---------------------------------------------------------------------------
  // (c) Base neuve (rejeu 2 fois)
  // ---------------------------------------------------------------------------
  const dbCatFresh = new PGlite();
  await dbCatFresh.exec(AUTH_STUB_SQL);
  for (let pass = 1; pass <= 2; pass += 1) {
    for (const s of installScripts) {
      await dbCatFresh.exec(readClientScript(s));
    }
  }
  await dbCatFresh.exec(`INSERT INTO public.stk_categories (name) VALUES ('EPI & Sécurité');`);
  const catFreshRows = await dbCatFresh.query(
    `SELECT id, name FROM public.stk_categories WHERE name = 'EPI & Sécurité';`
  );
  if (catFreshRows.rows.length !== 1) {
    throw new Error(`(c) base neuve : insertion dans stk_categories en échec.`);
  }
  await dbCatFresh.close();
  results.push('v44_lot1_c_fresh_db_categories_two_passes_ok');

  // ---------------------------------------------------------------------------
  // (d) Test « base héritée complète » :
  // Création préalable des 26 anciennes tables renommées par les scripts 09 et 11
  // sous leur ancien nom avec des colonnes minimales et des types d'identifiants variés
  // (texte, entier / bigserial, uuid), puis rejeu complet 2 fois : 0 erreur.
  // ---------------------------------------------------------------------------
  const dbFullLegacy = new PGlite();
  await dbFullLegacy.exec(AUTH_STUB_SQL);

  await dbFullLegacy.exec(`
    -- 1. Tables avec identifiant ENTIER / BIGSERIAL
    CREATE TABLE public.roles (id BIGINT PRIMARY KEY, name TEXT);
    INSERT INTO public.roles (id, name) VALUES (0, 'Super Admin'), (1, 'Admin');

    CREATE TABLE public.departments (id BIGSERIAL PRIMARY KEY, name TEXT);
    INSERT INTO public.departments (name) VALUES ('Électricité');

    CREATE TABLE public.users (id BIGSERIAL PRIMARY KEY, name TEXT);
    INSERT INTO public.users (name) VALUES ('Ancien Utilisateur');

    CREATE TABLE public.stock_levels (id BIGSERIAL PRIMARY KEY, product_id TEXT);
    CREATE TABLE public.stock_movements (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, product_id TEXT, movement_type TEXT, quantity_changed NUMERIC);
    CREATE TABLE public.movements (id BIGSERIAL PRIMARY KEY, product_id TEXT);
    CREATE TABLE public.audit_logs (id BIGSERIAL PRIMARY KEY, action TEXT);
    CREATE TABLE public.login_logs (id BIGSERIAL PRIMARY KEY, user_name TEXT);
    CREATE TABLE public.sub_categories (id BIGSERIAL PRIMARY KEY, name TEXT);
    INSERT INTO public.sub_categories (name) VALUES ('Disjoncteurs');
    CREATE TABLE public.app_compat (id INT PRIMARY KEY);

    -- 2. Tables avec identifiant TEXTE (sans séquence)
    CREATE TABLE public.categories (id TEXT PRIMARY KEY, name TEXT);
    INSERT INTO public.categories (id, name) VALUES ('cat-txt-01', 'Câblage');

    CREATE TABLE public.projects (id TEXT PRIMARY KEY, project_number TEXT);
    CREATE TABLE public.company_settings (id TEXT PRIMARY KEY, value TEXT);
    INSERT INTO public.company_settings (id, value) VALUES ('default_company', 'TOT Legacy');

    CREATE TABLE public.app_settings (id TEXT PRIMARY KEY, value TEXT);
    INSERT INTO public.app_settings (id, value) VALUES ('default_app', 'TOT App');

    CREATE TABLE public.license_config (id INT PRIMARY KEY, plan TEXT);
    INSERT INTO public.license_config (id, plan) VALUES (1, 'free');

    CREATE TABLE public.depots (id TEXT PRIMARY KEY, name TEXT);
    INSERT INTO public.depots (id, name) VALUES ('dep-old-1', 'Dépôt Historique');

    CREATE TABLE public.products (id TEXT PRIMARY KEY, reference TEXT);
    INSERT INTO public.products (id, reference) VALUES ('prd-old-1', 'REF-OLD-1');

    CREATE TABLE public.material_orders (id TEXT PRIMARY KEY, order_number TEXT);
    CREATE TABLE public.material_order_items (id INT PRIMARY KEY);
    CREATE TABLE public.inventory_audits (id TEXT PRIMARY KEY);
    CREATE TABLE public.inventory_audit_items (id TEXT PRIMARY KEY);
    CREATE TABLE public.order_preparations_log (id TEXT PRIMARY KEY);

    -- 3. Tables avec identifiant UUID
    CREATE TABLE public.processed_operations (operation_id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE public.files (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE public.print_stations (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE public.print_jobs (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
  `);

  for (let pass = 1; pass <= 2; pass += 1) {
    for (const s of installScripts) {
      await dbFullLegacy.exec(readClientScript(s));
    }
  }

  // Vérifier qu'aucune des 26 anciennes tables n'est restée une table physique (toutes renommées en core_* / stk_*)
  const remainingOldTables = await dbFullLegacy.query(`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN (
        'roles', 'departments', 'users', 'projects',
        'company_settings', 'app_settings', 'license_config', 'app_compat',
        'audit_logs', 'login_logs', 'processed_operations', 'files',
        'sub_categories', 'categories', 'depots', 'products',
        'stock_levels', 'stock_movements', 'movements',
        'material_orders', 'material_order_items',
        'print_stations', 'print_jobs',
        'inventory_audits', 'inventory_audit_items', 'order_preparations_log'
      );
  `);
  if (remainingOldTables.rows.length !== 0) {
    throw new Error(
      `Certaines anciennes tables n'ont pas été renommées : ${JSON.stringify(remainingOldTables.rows)}`
    );
  }

  const fullDiag = await dbFullLegacy.query(`SELECT * FROM public.diagnostic_installation();`);
  const fullKo = fullDiag.rows.filter(
    (r) => r.check_key !== 'super_admin_linked' && (r.status === 'KO' || r.status === 'ERREUR')
  );
  if (fullKo.length > 0) {
    throw new Error(
      `diagnostic_installation() en erreur sur base héritée complète : ${JSON.stringify(fullKo)}`
    );
  }

  await dbFullLegacy.close();
  results.push('v44_lot1_d_full_legacy_26_tables_varied_types_two_passes_ok');

  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  Promise.all([runPrintJobsSqlTests(), runLegacySchemaSqlTests()])
    .then(([res1, res2]) => {
      console.log('✅ SQL Tests (v42/v44 core_/stk_ prefixes, legacy schemas, print_jobs & RLS purge) passed:', [
        ...res1,
        ...res2,
      ]);
    })
    .catch((err) => {
      console.error('❌ SQL Tests failed:', err);
      process.exit(1);
    });
}

