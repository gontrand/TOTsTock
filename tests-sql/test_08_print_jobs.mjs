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
  const koRows = diagRes.rows.filter((r) => r.status === 'KO');
  if (koRows.length > 0 || diagRes.rows.length < 9) {
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
  const upgKoRows = upgDiag.rows.filter((r) => r.status === 'KO');
  if (upgKoRows.length > 0 || upgDiag.rows.length < 9) {
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
      (20, 'Role Avec Impression', ARRAY['perm_menu_print_labels', 'perm_menu_order_prep']::text[])
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
  // Insérer 30 travaux PENDING sur stationNordId (en contournant la fenêtre de 10/min par des timestamps étalés)
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

  await db.close();
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runPrintJobsSqlTests()
    .then((res) => {
      console.log('✅ SQL Tests (08_print_jobs.sql) passed:', res);
    })
    .catch((err) => {
      console.error('❌ SQL Tests failed:', err);
      process.exit(1);
    });
}
