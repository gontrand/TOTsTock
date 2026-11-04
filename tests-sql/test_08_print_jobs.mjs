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
  // TEST 1A : Exécution sur une base vide (00 à 08 + 07) puis 2 passages d'affilée (idempotent)
  // ---------------------------------------------------------------------------
  const db = new PGlite();
  await db.exec(AUTH_STUB_SQL);

  const orderedScripts = [
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

  // Passage 1
  for (const scriptName of orderedScripts) {
    await db.exec(readClientScript(scriptName));
  }
  // Passage 2 (idempotence complète)
  for (const scriptName of orderedScripts) {
    await db.exec(readClientScript(scriptName));
  }

  const compatRes = await db.query(
    `SELECT schema_version, min_schema_version FROM public.app_compat WHERE id = 1;`
  );
  if (
    compatRes.rows[0]?.schema_version !== '1.1.0' ||
    compatRes.rows[0]?.min_schema_version !== '1.0.0'
  ) {
    throw new Error(
      `Version de schéma inattendue après installation complète : ${JSON.stringify(compatRes.rows[0])}`
    );
  }

  const diagRes = await db.query(`SELECT * FROM public.diagnostic_installation();`);
  const koRows = diagRes.rows.filter(
    (r) => r.check_key !== 'super_admin_linked' && (r.status === 'KO' || r.status === 'ERREUR')
  );
  if (koRows.length > 0 || diagRes.rows.length < 10) {
    throw new Error(
      `diagnostic_installation() a échoué après double passage : ${JSON.stringify(diagRes.rows)}`
    );
  }
  results.push('1a_fresh_install_and_idempotent_two_passes_ok');

  // ---------------------------------------------------------------------------
  // TEST 1B : Mise à niveau d'une base existante en version 1.0.0 vers 1.1.0 via 08_print_jobs.sql seul
  // ---------------------------------------------------------------------------
  const dbUpgrade = new PGlite();
  await dbUpgrade.exec(AUTH_STUB_SQL);
  const v100Scripts = [
    '00_complete_tot_stock_schema.sql',
    '01_auth_link.sql',
    '02_rls_hardening.sql',
    '03_rpc_stock_and_orders.sql',
    '04_mouvements_et_depots_vehicules.sql',
    '05_rpc_admin_users.sql',
    '06_install_additional_roles.sql',
    '07_app_compat.sql',
  ];
  for (const s of v100Scripts) {
    await dbUpgrade.exec(readClientScript(s));
  }
  // Simuler l'état 1.0.0 avant le script 08
  await dbUpgrade.exec(`
    DROP TABLE IF EXISTS public.print_jobs CASCADE;
    DROP TABLE IF EXISTS public.print_stations CASCADE;
    UPDATE public.app_compat SET schema_version = '1.0.0', min_schema_version = '1.0.0' WHERE id = 1;
  `);

  // Exécuter uniquement 08_print_jobs.sql (mise à niveau seule)
  await dbUpgrade.exec(readClientScript('08_print_jobs.sql'));
  // Et rejouer 08_print_jobs.sql une seconde fois
  await dbUpgrade.exec(readClientScript('08_print_jobs.sql'));

  const upgCompat = await dbUpgrade.query(
    `SELECT schema_version, min_schema_version FROM public.app_compat WHERE id = 1;`
  );
  if (upgCompat.rows[0]?.schema_version !== '1.1.0') {
    throw new Error(`La mise à niveau 1.0.0 -> 1.1.0 n'a pas mis à jour schema_version.`);
  }
  const upgDiag = await dbUpgrade.query(`SELECT * FROM public.diagnostic_installation();`);
  const upgKoRows = upgDiag.rows.filter(
    (r) => r.check_key !== 'super_admin_linked' && (r.status === 'KO' || r.status === 'ERREUR')
  );
  if (upgKoRows.length > 0 || upgDiag.rows.length < 10) {
    throw new Error(
      `diagnostic_installation() a échoué après mise à niveau 1.0.0 -> 1.1.0 : ${JSON.stringify(upgDiag.rows)}`
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
    INSERT INTO public.roles (id, name, permissions)
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

    INSERT INTO public.users (id, name, email, pin, role_id, is_blocked, allowed_depots, is_preparer, auth_user_id)
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
  // user-depot-a tente de réclamer (claim_print_jobs) ou lire (list_station_print_jobs) les travaux du Poste Sud
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
  // Terminer le travail réclamé
  await db.query(`SELECT public.complete_print_job($1::uuid, true, NULL);`, [claim1.rows[0].id]);
  results.push('5_claim_print_jobs_idempotent_single_claim');

  // ---------------------------------------------------------------------------
  // TEST 6 : Limites respectées : copies entre 1 et 100, payload <= 2048 octets et sans HTML, 30 PENDING max par poste
  // ---------------------------------------------------------------------------
  await setAuthUser(UUID_DEPOT_A);
  // 6a. copies invalides (0 et 101)
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

  // 6b. payload > 2048 octets
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

  // 6c. payload contenant des balises HTML
  await expectSqlFailure(
    () =>
      db.query(
        `SELECT public.create_print_job($1::uuid, 'product_label', 'avery_70x37', '{"product_id":"P1","product_ref":"<script>alert(1)</script>"}'::jsonb, 1, NULL);`,
        [stationNordId]
      ),
    'html'
  );

  // 6d. Plafond de 30 travaux PENDING maximum par poste
  await db.exec(`
    INSERT INTO public.print_jobs (station_id, created_by, kind, format, payload, copies, status, created_at)
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

  // Nettoyer les 30 travaux de test
  await db.exec(`DELETE FROM public.print_jobs WHERE station_id = '${stationNordId}'::uuid;`);
  results.push('6_limits_30_pending_copies_1_100_payload_2048_enforced');

  // ---------------------------------------------------------------------------
  // TEST 7 : anon n'a aucun droit sur print_stations, print_jobs ni sur les fonctions d'impression
  // ---------------------------------------------------------------------------
  const anonTableGrants = await db.query(`
    SELECT table_name, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee = 'anon'
      AND table_name IN ('print_stations', 'print_jobs');
  `);
  if (anonTableGrants.rows.length > 0) {
    throw new Error(
      `Le rôle anon possède des droits sur print_stations/print_jobs : ${JSON.stringify(anonTableGrants.rows)}`
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

  // Deuxième appel avec la même dedupe_key tant que le 1er est PENDING -> rejeté (contrainte unique 23505)
  await expectSqlFailure(
    () =>
      db.query(
        `SELECT public.create_print_job($1::uuid, 'order_label', 'bin_90x50', '{"order_id":"ORD1","order_number":"CMD-2026-900"}'::jsonb, 1, 'order:CMD-2026-900') AS id;`,
        [stationNordId]
      ),
    ''
  );

  // Annuler le premier travail (passe en CANCELLED), puis vérifier qu'un nouvel envoi avec la même dedupe_key est autorisé
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
  // TEST 9 (v37) : Purge intégrale des règles RLS parasites / récursives et contrôle diagnostic
  // ---------------------------------------------------------------------------
  // 9.1 Créer la table optionnelle material_order_items (si présente sur d'anciennes bases)
  //     et injecter des règles RLS parasites aux noms inventés + une règle récursive sur users
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.material_order_items (
      id SERIAL PRIMARY KEY,
      order_id BIGINT,
      product_id TEXT,
      quantity INTEGER DEFAULT 1
    );
    ALTER TABLE public.material_order_items ENABLE ROW LEVEL SECURITY;

    GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO anon;

    DROP POLICY IF EXISTS "Allow public access to users" ON public.users;
    CREATE POLICY "Allow public access to users" ON public.users
      FOR ALL TO public USING (true);

    DROP POLICY IF EXISTS "Accès total users" ON public.users;
    CREATE POLICY "Accès total users" ON public.users
      FOR ALL TO public USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Legacy recursive read users" ON public.users;
    CREATE POLICY "Legacy recursive read users" ON public.users
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.users u_rec
          WHERE u_rec.auth_user_id = auth.uid()
            AND (u_rec.role_id = 0 OR u_rec.id = users.id)
        )
      );

    DROP POLICY IF EXISTS "Legacy order policy referencing users" ON public.material_orders;
    CREATE POLICY "Legacy order policy referencing users" ON public.material_orders
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.users u_ord
          WHERE u_ord.auth_user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Allow public access to products" ON public.products;
    CREATE POLICY "Allow public access to products" ON public.products
      FOR ALL TO public USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Legacy public order items" ON public.material_order_items;
    CREATE POLICY "Legacy public order items" ON public.material_order_items
      FOR ALL TO public USING (true);

    DROP POLICY IF EXISTS "Parasite public print_stations" ON public.print_stations;
    CREATE POLICY "Parasite public print_stations" ON public.print_stations
      FOR ALL TO public USING (true);

    DROP POLICY IF EXISTS "Parasite anon print_jobs" ON public.print_jobs;
    CREATE POLICY "Parasite anon print_jobs" ON public.print_jobs
      FOR ALL TO anon USING (true);
  `);

  // 9.1b Vérifier que la règle récursive parasite provoque bien l'erreur 42P17 lors d'un INSERT dans material_orders avant purge
  await expectSqlFailure(
    () =>
      db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${UUID_DEPOT_A}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
        INSERT INTO public.material_orders (
          id, order_number, requester_id, requester_name, site_number, site_name, status, items
        ) VALUES (
          'ord-rec-fail', 'CMD-REC-FAIL', 'user-depot-a', 'Magasinier Nord', 'CH-100', 'Chantier', 'PENDING', '[]'::jsonb
        );
        COMMIT;
      `),
    'infinite recursion detected in policy for relation "users"'
  );
  await db.exec(`ROLLBACK;`);

  // 9.2 Vérifier qu'AVANT rejeu des scripts de durcissement, diagnostic_installation() détecte les règles USING (true) en ERREUR
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
    !permissiveRowBefore.details.includes('users') ||
    !permissiveRowBefore.details.includes('products')
  ) {
    throw new Error(
      `permissive_rls_policies devait citer users et products, reçu : ${permissiveRowBefore.details}`
    );
  }

  // 9.3 Exécuter les scripts 02, 03, 04, 05, 07, 08 (et rejouer 02, 05, 08, 07 pour vérifier l'idempotence)
  for (const scriptToReplay of [
    '02_rls_hardening.sql',
    '03_rpc_stock_and_orders.sql',
    '04_mouvements_et_depots_vehicules.sql',
    '05_rpc_admin_users.sql',
    '08_print_jobs.sql',
    '07_app_compat.sql',
  ]) {
    await db.exec(readClientScript(scriptToReplay));
  }

  // 9.4 Vérifier que la fonction utilitaire temporaire _tot_drop_all_policies_on_table n'existe plus
  const helperFnRes = await db.query(`
    SELECT proname FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_tot_drop_all_policies_on_table';
  `);
  if (helperFnRes.rows.length > 0) {
    throw new Error('La fonction temporaire _tot_drop_all_policies_on_table aurait dû être supprimée en fin de script 02.');
  }

  // 9.5 Vérifier qu'il ne reste QUE les règles attendues sur chaque table (aucune règle parasite ne survit)
  const expectedPoliciesByTable = {
    users: ['Authenticated read users'],
    products: ['Admin write products', 'Authenticated read products'],
    stock_movements: ['Authenticated insert stock_movements', 'Authenticated read stock_movements'],
    movements: ['Authenticated insert movements', 'Authenticated read movements'],
    material_orders: [
      'Authenticated insert material_orders',
      'Authenticated read material_orders',
      'Authenticated update material_orders',
    ],
    material_order_items: [
      'Authenticated read material_order_items',
      'Authenticated write material_order_items',
    ],
    depots: ['Admin write depots', 'Authenticated read depots'],
    app_settings: ['Admin write app_settings', 'Anon public settings', 'Authenticated read app_settings'],
    company_settings: [
      'Admin write company_settings',
      'Anon public company_settings',
      'Authenticated read company_settings',
    ],
    license_config: ['Authenticated read license_config'],
    roles: ['Admin write roles', 'Authenticated read roles'],
    departments: ['Admin write departments', 'Authenticated read departments'],
    projects: ['Admin write projects', 'Authenticated read projects'],
    sub_categories: ['Admin write sub_categories', 'Authenticated read sub_categories'],
    stock_levels: ['Admin write stock_levels', 'Authenticated read stock_levels'],
    audit_logs: ['Authenticated insert audit_logs', 'Authenticated read audit_logs'],
    processed_operations: ['User read self processed_operations'],
    app_compat: ['Lecture de la compatibilité', 'Modification compatibilité admin'],
    print_stations: [],
    print_jobs: [],
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

  // 9.6 Vérifier qu'anon ne peut ni lire ni écrire public.users (ni par privilège de table ni sous SET LOCAL ROLE anon)
  const anonUsersPrivRes = await db.query(`
    SELECT
      has_table_privilege('anon', 'public.users', 'SELECT') AS can_select,
      has_table_privilege('anon', 'public.users', 'INSERT') AS can_insert,
      has_table_privilege('anon', 'public.users', 'UPDATE') AS can_update,
      has_table_privilege('anon', 'public.users', 'DELETE') AS can_delete;
  `);
  const anonPriv = anonUsersPrivRes.rows[0];
  if (anonPriv.can_select || anonPriv.can_insert || anonPriv.can_update || anonPriv.can_delete) {
    throw new Error(`Le rôle anon conserve des privilèges sur public.users : ${JSON.stringify(anonPriv)}`);
  }

  await expectSqlFailure(
    () =>
      db.exec(`
        BEGIN;
        SET LOCAL ROLE anon;
        SELECT count(*) FROM public.users;
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
        INSERT INTO public.users (id, name, role_id) VALUES ('pirate-anon', 'Pirate', 0);
        COMMIT;
      `),
    'permission denied'
  );
  await db.exec(`ROLLBACK;`);

  // 9.7 Vérifier que l'insertion d'une commande (material_orders) et la lecture de users
  //     par un utilisateur authentifié autorisé réussissent sous RLS actif sans erreur de récursion 42P17
  await db.exec(`
    BEGIN;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${UUID_DEPOT_A}', true);
    SELECT set_config('request.jwt.claim.role', 'authenticated', true);

    SELECT id, name, role_id FROM public.users WHERE id = 'user-depot-a';

    INSERT INTO public.material_orders (
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
    `SELECT order_number, status FROM public.material_orders WHERE order_number = 'CMD-RLS-NON-RECURSIVE-001';`
  );
  if (insertedOrderRes.rows.length !== 1) {
    throw new Error('La commande insérée sous le rôle authenticated est introuvable.');
  }

  // 9.8 Vérifier que diagnostic_installation() renvoie désormais OK sur permissive_rls_policies et aucune ligne KO/ERREUR
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

  // 9.9 Vérifier que si on recrée ensuite une règle USING (true) pour public, diagnostic_installation() renvoie ERREUR
  await db.exec(`
    CREATE POLICY "Allow public access to users" ON public.users
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
  // Nettoyage final
  await db.exec(`DROP POLICY IF EXISTS "Allow public access to users" ON public.users;`);
  results.push('9_rls_purge_parasite_and_recursive_policies_and_diagnostic_ok');

  // ---------------------------------------------------------------------------
  // TEST 10 (v39) : Base ancienne avec stock_movements.id bigint GENERATED BY DEFAULT AS IDENTITY
  // contenant 2 lignes -> rejeu de 02, 03, 04, 05, 06, 07, 08 -> aucune erreur, id de type text,
  // 2 lignes conservées (ids '1' et '2'), process_stock_movement insère un id texte généré,
  // rejeu idempotent, absence de ligne parasite _tot_drop_all_policies_on_table au script 02,
  // et message clair « conversion impossible : <objet dépendant> » si une vue/FK bloque la conversion.
  // ---------------------------------------------------------------------------
  const dbLegacy = new PGlite();
  await dbLegacy.exec(AUTH_STUB_SQL);
  await dbLegacy.exec(readClientScript('00_complete_tot_stock_schema.sql'));
  await dbLegacy.exec(readClientScript('01_auth_link.sql'));

  // Préparer stock_movements (ainsi que movements, audit_logs, stock_levels) avec id bigint GENERATED BY DEFAULT AS IDENTITY
  // et insérer 2 lignes historiques dans stock_movements
  await dbLegacy.exec(`
    INSERT INTO public.products (id, reference, brand, model, store_name, quantity, min_stock_alert)
    VALUES ('prod-legacy-1', 'REF-LEG-001', 'Bosch', 'Perceuse 18V', 'Dépôt Nord', 10, 2)
    ON CONFLICT (id) DO NOTHING;

    DROP TABLE IF EXISTS public.stock_movements CASCADE;
    CREATE TABLE public.stock_movements (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
      product_ref TEXT,
      user_id TEXT,
      user_name TEXT,
      movement_type TEXT NOT NULL CHECK (movement_type IN ('IN', 'OUT')),
      quantity_changed NUMERIC(10,2) NOT NULL,
      site_number TEXT,
      department_name TEXT,
      depot_name TEXT,
      dest_depot_name TEXT,
      total_cost NUMERIC(10,2) DEFAULT 0,
      order_number TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    DROP TABLE IF EXISTS public.movements CASCADE;
    CREATE TABLE public.movements (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
      product_ref TEXT,
      user_id TEXT,
      user_name TEXT,
      movement_type TEXT NOT NULL CHECK (movement_type IN ('IN', 'OUT')),
      quantity_changed NUMERIC(10,2) NOT NULL,
      site_number TEXT,
      department_name TEXT,
      depot_name TEXT,
      dest_depot_name TEXT,
      total_cost NUMERIC(10,2) DEFAULT 0,
      order_number TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO public.movements (product_id, product_ref, user_id, user_name, movement_type, quantity_changed, depot_name)
    VALUES ('prod-legacy-1', 'REF-LEG-001', 'user-admin', 'Super Admin', 'IN', 10, 'Dépôt Nord');

    DELETE FROM public.audit_logs;
    ALTER TABLE public.audit_logs ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE public.audit_logs ALTER COLUMN id TYPE BIGINT USING id::bigint;
    ALTER TABLE public.audit_logs ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY;
    INSERT INTO public.audit_logs (user_id, user_name, action)
    VALUES ('user-admin', 'Super Admin', 'LEGACY_INIT');

    DROP TABLE IF EXISTS public.stock_levels CASCADE;
    CREATE TABLE public.stock_levels (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      product_id TEXT NOT NULL,
      depot_name TEXT NOT NULL,
      quantity NUMERIC NOT NULL DEFAULT 0,
      min_stock NUMERIC DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      CONSTRAINT uq_product_depot UNIQUE (product_id, depot_name)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_levels_product_depot ON public.stock_levels (product_id, depot_name);
    INSERT INTO public.stock_levels (product_id, depot_name, quantity)
    VALUES ('prod-legacy-1', 'Dépôt Nord', 10);

    INSERT INTO public.stock_movements (product_id, product_ref, user_id, user_name, movement_type, quantity_changed, depot_name)
    VALUES
      ('prod-legacy-1', 'REF-LEG-001', 'user-admin', 'Super Admin', 'IN', 6, 'Dépôt Nord'),
      ('prod-legacy-1', 'REF-LEG-001', 'user-admin', 'Super Admin', 'IN', 4, 'Dépôt Nord');
  `);

  // 10.1 Vérifier que si une vue dépend de stock_movements.id, l'erreur remonte avec « conversion impossible : ... » sans rien modifier
  await dbLegacy.exec(`
    CREATE VIEW public.v_blocking_stock_movements AS
    SELECT id, product_id FROM public.stock_movements;
  `);
  await dbLegacy.exec(readClientScript('02_rls_hardening.sql'));
  await expectSqlFailure(
    () => dbLegacy.exec(readClientScript('03_rpc_stock_and_orders.sql')),
    'conversion impossible :'
  );
  // Vérifier que stock_movements.id est toujours bigint et que stock_movements_backup_ids n'a pas été laissé modifié suite au rollback
  const colStillBigint = await dbLegacy.query(`
    SELECT data_type, is_identity
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stock_movements' AND column_name = 'id';
  `);
  if (colStillBigint.rows[0]?.data_type !== 'bigint' || colStillBigint.rows[0]?.is_identity !== 'YES') {
    throw new Error(
      `Après échec sur vue dépendante, stock_movements.id devait rester bigint IDENTITY sans modification, reçu : ${JSON.stringify(colStillBigint.rows[0])}`
    );
  }
  await dbLegacy.exec(`DROP VIEW public.v_blocking_stock_movements;`);

  // 10.2 Rejeu complet de 02, 03, 04, 05, 06, 07, 08 (et vérification qu'aucune ligne _tot_drop_all_policies_on_table n'est émise par 02)
  const script02Results = await dbLegacy.exec(readClientScript('02_rls_hardening.sql'));
  const spurious02Output = script02Results.filter(
    (stmtRes) =>
      (stmtRes.fields && stmtRes.fields.some((f) => f.name === '_tot_drop_all_policies_on_table')) ||
      (Array.isArray(stmtRes.rows) && stmtRes.rows.length > 0)
  );
  if (spurious02Output.length > 0) {
    throw new Error(
      `02_rls_hardening.sql a renvoyé des lignes de résultat parasites : ${JSON.stringify(spurious02Output)}`
    );
  }

  for (const s of [
    '03_rpc_stock_and_orders.sql',
    '04_mouvements_et_depots_vehicules.sql',
    '05_rpc_admin_users.sql',
    '06_install_additional_roles.sql',
    '07_app_compat.sql',
    '08_print_jobs.sql',
  ]) {
    await dbLegacy.exec(readClientScript(s));
  }

  // 10.3 Vérifier que stock_movements.id, movements.id, audit_logs.id et stock_levels.id sont maintenant de type 'text' et is_identity = 'NO'
  for (const tName of ['stock_movements', 'movements', 'audit_logs', 'stock_levels']) {
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

  // 10.4 Vérifier que les 2 lignes historiques sont conservées avec les ids '1' et '2'
  const preservedRows = await dbLegacy.query(`
    SELECT id, product_id, quantity_changed
    FROM public.stock_movements
    ORDER BY id ASC;
  `);
  if (
    preservedRows.rows.length !== 2 ||
    preservedRows.rows[0].id !== '1' ||
    preservedRows.rows[1].id !== '2'
  ) {
    throw new Error(
      `Les 2 lignes historiques de stock_movements ('1' et '2') devaient être conservées, reçu : ${JSON.stringify(preservedRows.rows)}`
    );
  }

  // 10.5 Exécuter un process_stock_movement ultérieur et vérifier qu'il insère avec un id texte généré
  const UUID_LEG_ADMIN = '00000000-0000-4000-8000-000000000199';
  await dbLegacy.exec(`
    INSERT INTO auth.users (id, email)
    VALUES ('${UUID_LEG_ADMIN}', 'legadmin@test.local')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.users (id, name, trigram, email, pin, role_id, is_blocked, allowed_depots, is_preparer, auth_user_id)
    VALUES ('user-leg-admin', 'Admin Legacy', 'ADM', 'legadmin@test.local', '', 0, false, ARRAY['*']::text[], true, '${UUID_LEG_ADMIN}')
    ON CONFLICT (id) DO UPDATE SET role_id = 0, auth_user_id = EXCLUDED.auth_user_id, is_blocked = false;

    INSERT INTO public.depots (id, name, type, is_active)
    VALUES ('depot-nord-id', 'Dépôt Nord', 'FIXED', true)
    ON CONFLICT (name) DO NOTHING;

    SELECT set_config('request.jwt.claim.sub', '${UUID_LEG_ADMIN}', false);
  `);

  const moveRes = await dbLegacy.query(`
    SELECT public.process_stock_movement(
      '11111111-2222-4333-8444-555555555555'::uuid,
      'prod-legacy-1',
      'Dépôt Nord',
      'IN',
      5,
      'Réappro test v39',
      NULL,
      'Logistique',
      NULL,
      NULL,
      '{}'::jsonb,
      'STOCK_DIRECT_MOVE'
    ) AS res;
  `);
  if (!moveRes.rows[0]?.res) {
    throw new Error('process_stock_movement a échoué après conversion de stock_movements.id.');
  }

  const allMovsAfterRpc = await dbLegacy.query(`
    SELECT id, quantity_changed
    FROM public.stock_movements
    ORDER BY created_at ASC, id ASC;
  `);
  if (allMovsAfterRpc.rows.length !== 3) {
    throw new Error(
      `Attendu 3 lignes dans stock_movements après process_stock_movement, reçu : ${JSON.stringify(allMovsAfterRpc.rows)}`
    );
  }
  const generatedRow = allMovsAfterRpc.rows.find((r) => r.id !== '1' && r.id !== '2');
  if (!generatedRow || typeof generatedRow.id !== 'string' || generatedRow.id.length < 10) {
    throw new Error(
      `La nouvelle ligne insérée par process_stock_movement devait avoir un id texte généré, reçu : ${JSON.stringify(generatedRow)}`
    );
  }

  // 10.6 Rejeu idempotent de 02, 03, 04, 05, 06, 07, 08
  for (const s of [
    '02_rls_hardening.sql',
    '03_rpc_stock_and_orders.sql',
    '04_mouvements_et_depots_vehicules.sql',
    '05_rpc_admin_users.sql',
    '06_install_additional_roles.sql',
    '07_app_compat.sql',
    '08_print_jobs.sql',
  ]) {
    await dbLegacy.exec(readClientScript(s));
  }

  const rowsAfterReplay = await dbLegacy.query(`SELECT id FROM public.stock_movements;`);
  if (rowsAfterReplay.rows.length !== 3) {
    throw new Error('Le rejeu idempotent de 02..08 a altéré les lignes de stock_movements.');
  }

  await dbLegacy.close();
  results.push('10_legacy_identity_bigint_id_conversion_and_idempotent_ok');

  await db.close();
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runPrintJobsSqlTests()
    .then((res) => {
      console.log('✅ SQL Tests (08_print_jobs.sql & RLS purge v37) passed:', res);
    })
    .catch((err) => {
      console.error('❌ SQL Tests failed:', err);
      process.exit(1);
    });
}

