-- =========================================================================
-- FICHIER GÉNÉRÉ AUTOMATIQUEMENT PAR scripts/build-sql.mjs — NE PAS MODIFIER DIRECTEMENT
-- Source de vérité : supabase-client/07_app_compat.sql
-- Étape 07 : Table app_compat, is_active_admin(), diagnostic_installation() et durcissement final anon
-- =========================================================================
-- TOT STOCK - SCRIPT 07 : COMPATIBILITÉ APPLICATION, SCHÉMA & DIAGNOSTIC (07_app_compat.sql)
-- Description : Définit is_active_admin(), la table singleton public.core_app_compat (schema_version 2.10.0,
--   min_schema_version 1.0.0, latest_version 5.16.1), la fonction RPC public.diagnostic_installation()
--   (17 contrôles, réservée aux rôles 0, 1 et 5) et le durcissement final des fonctions SECURITY DEFINER.
-- Dépendances : Scripts 00, 09, 01 (01b), 02, 03, 04, 05, 06, 08, 11, 12, 13, 14, 15, 16, 17 et 18.
-- Ordre d'exécution : Toujours exécuté EN DERNIER.
-- Rejouable : oui (idempotent)
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. VÉRIFICATION DES PRÉREQUIS (Point 3)
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'core_users'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (07_app_compat.sql) : La table public.core_users est absente. Exécutez d''abord les scripts 01 à 06.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'core_users' AND column_name = 'auth_user_id'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (07_app_compat.sql) : La colonne public.core_users.auth_user_id est absente. Exécutez d''abord 01_auth_link.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'core_license_config'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (07_app_compat.sql) : La table public.core_license_config est absente. Exécutez d''abord 02_rls_hardening.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'plan_limits'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (07_app_compat.sql) : La fonction public.plan_limits(TEXT) est absente. Exécutez d''abord 02_rls_hardening.sql.';
  END IF;
END $$;

-- =========================================================================
-- 1. CRÉATION DE LA FONCTION UNIQUE is_active_admin() (Point 6)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.core_users 
    WHERE (auth_user_id = auth.uid() OR id::text = auth.uid()::text)
      AND COALESCE(is_blocked, false) = false 
      AND role_id IN (0, 1)
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_admin() TO authenticated;

-- =========================================================================
-- 2. TOT STOCK : TABLE DE COMPATIBILITÉ & MODE MAINTENANCE (core_app_compat) (Point 4 & 6)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.core_app_compat (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  schema_version     TEXT NOT NULL DEFAULT '2.10.0',
  min_schema_version TEXT NOT NULL DEFAULT '1.0.0',
  min_app_version    TEXT NOT NULL DEFAULT '1.0.0',
  latest_version     TEXT,                          -- Optionnel : notification MAJ non bloquante
  update_url         TEXT,                          -- Optionnel : lien APK / store / web
  maintenance        BOOLEAN NOT NULL DEFAULT false,-- Coupe-circuit pendant les migrations SQL
  message            TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ajout additif et idempotent des colonnes (dont min_schema_version requis au Point 4)
ALTER TABLE public.core_app_compat
  ADD COLUMN IF NOT EXISTS min_schema_version TEXT NOT NULL DEFAULT '1.0.0',
  ADD COLUMN IF NOT EXISTS latest_version TEXT,
  ADD COLUMN IF NOT EXISTS update_url TEXT,
  ADD COLUMN IF NOT EXISTS maintenance BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Activation du RLS et purge de toute règle existante sur public.core_app_compat
ALTER TABLE public.core_app_compat ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'core_app_compat'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.core_app_compat', r.policyname);
  END LOOP;
END $$;

-- Lecture publique (permet le check avant le login)
CREATE POLICY "Lecture de la compatibilité" ON public.core_app_compat
  FOR SELECT TO anon, authenticated
  USING (true);

GRANT SELECT ON TABLE public.core_app_compat TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.core_app_compat FROM anon, PUBLIC;

-- Modification réservée aux administrateurs actifs (via is_active_admin())
CREATE POLICY "Modification compatibilité admin" ON public.core_app_compat
  FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

-- Trigger automatique pour actualiser updated_at
CREATE OR REPLACE FUNCTION public.set_app_compat_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_compat_updated_at ON public.core_app_compat;
CREATE TRIGGER trg_app_compat_updated_at
  BEFORE UPDATE ON public.core_app_compat
  FOR EACH ROW
  EXECUTE FUNCTION public.set_app_compat_updated_at();

-- Initialisation de la configuration par défaut (singleton id=1)
-- v42 : schema_version passe à 2.0.0 (tables préfixées core_ et stk_), min_schema_version reste à 1.0.0
CREATE UNIQUE INDEX IF NOT EXISTS uq_core_app_compat_id ON public.core_app_compat (id);

INSERT INTO public.core_app_compat (id, schema_version, min_schema_version, min_app_version, latest_version, message)
VALUES (1, '2.10.0', '1.0.0', '1.0.0', '5.16.1', NULL)
ON CONFLICT (id) DO UPDATE
SET schema_version = '2.10.0',
    min_schema_version = COALESCE(NULLIF(TRIM(public.core_app_compat.min_schema_version), ''), '1.0.0'),
    latest_version = '5.16.1';

-- =========================================================================
-- 3. DIAGNOSTIC D'INSTALLATION (Point 7, v37, v40, v41, v42)
-- Fonction SQL public.diagnostic_installation() (SECURITY DEFINER, SET search_path = public)
-- Réservée aux rôles 0 (Super Admin), 1 (Administrateur) et 5 (Admin IT).
-- Retourne une ligne par contrôle avec statut OK / ATTENTION / ERREUR, sans données personnelles.
-- =========================================================================
DROP FUNCTION IF EXISTS public.diagnostic_installation();
CREATE OR REPLACE FUNCTION public.diagnostic_installation()
RETURNS TABLE (
  check_key TEXT,
  check_label TEXT,
  status TEXT,
  details TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role INT;
  v_expected_tables TEXT[] := ARRAY[
    'core_roles', 'core_departments', 'core_users', 'core_projects', 'stk_sub_categories',
    'stk_depots', 'stk_products', 'stk_stock_levels', 'stk_movements', 'stk_material_orders',
    'core_app_settings', 'core_audit_logs', 'core_license_config', 'core_app_compat',
    'stk_print_stations', 'stk_print_jobs',
    'stk_inventory_audits', 'stk_inventory_audit_items', 'stk_order_preparations_log',
    'stk_categories', 'stk_material_order_items', 'core_files', 'core_user_preferences',
    'core_mail_accounts', 'core_mail_senders', 'core_mail_log'
  ];
  v_legacy_names TEXT[] := ARRAY[
    'users', 'roles', 'departments', 'projects', 'company_settings',
    'app_settings', 'license_config', 'app_compat', 'audit_logs', 'login_logs',
    'processed_operations', 'files', 'products', 'categories', 'sub_categories',
    'stock_levels', 'depots', 'stock_movements', 'movements', 'material_orders',
    'material_order_items', 'print_jobs', 'print_stations', 'inventory_audits',
    'inventory_audit_items', 'order_preparations_log'
  ];
  v_explicit_public_select_tables TEXT[] := ARRAY['core_app_compat'];
  v_tbl TEXT;
  v_missing_tables TEXT[] := ARRAY[]::TEXT[];
  v_no_rls_tables TEXT[] := ARRAY[]::TEXT[];
  v_rls_enabled BOOLEAN;
  v_anon_leaks TEXT[] := ARRAY[]::TEXT[];
  v_pol RECORD;
  v_permissive_policies TEXT[] := ARRAY[]::TEXT[];
  v_permissive_tables TEXT[] := ARRAY[]::TEXT[];
  v_super_admin_count INT := 0;
  v_plain_pin_count INT := 0;
  v_has_pin_col BOOLEAN := false;
  v_schema_ver TEXT;
  v_min_schema_ver TEXT;
  v_min_app_ver TEXT;
  v_maint BOOLEAN;
  v_lic_plan TEXT := 'free';
  v_lic_modules TEXT[] := ARRAY['stock']::TEXT[];
  v_lic_max_depots INT := 1;
  v_active_depots INT := 0;
  v_limits JSONB;
  v_sensitive_funcs TEXT[] := ARRAY[
    'handle_auth_user_created',
    'get_or_link_my_profile',
    'diagnostic_installation',
    'enforce_license_max_references_quota',
    'enforce_license_max_depots_quota',
    'process_stock_movement',
    'transfer_stock_batch',
    'send_stock_transfer',
    'receive_stock_transfer',
    'reject_stock_transfer',
    'cancel_stock_transfer',
    'confirm_stock_transfer_adjustment',
    'resolve_transfer_dispute',
    'list_overdue_transfers',
    'get_stock_levels_report',
    'set_depot_holders',
    'get_email_secret',
    'get_mail_config',
    'set_mail_account_secret',
    'mail_account_has_secret',
    'purge_mail_log',
    'register_print_station',
    'list_print_stations',
    'create_print_job',
    'claim_print_jobs',
    'complete_print_job',
    'cancel_print_job',
    'purge_print_jobs',
    'get_print_job_status',
    'list_station_print_jobs',
    'search_material_orders',
    'search_stock_movements',
    'log_audit_event',
    'log_login_event',
    'purge_audit_logs',
    'search_audit_logs',
    'search_login_logs',
    'purge_expired_password_resets'
  ];
  v_print_rpc_funcs TEXT[] := ARRAY[
    'register_print_station',
    'list_print_stations',
    'create_print_job',
    'claim_print_jobs',
    'complete_print_job',
    'cancel_print_job',
    'purge_print_jobs'
  ];
  v_missing_print_funcs TEXT[] := ARRAY[]::TEXT[];
  v_fn TEXT;
  v_fn_oid OID;
  v_exposed_funcs TEXT[] := ARRAY[]::TEXT[];
  v_edge_meta TEXT := NULL;
  v_has_email_secret_fn BOOLEAN := false;
  v_has_stock_levels_tbl BOOLEAN := false;
  v_has_process_mov_12 BOOLEAN := false;
  v_has_transfer_batch_fn BOOLEAN := false;
  v_unknown_triggers TEXT[] := ARRAY[]::TEXT[];
  v_trig RECORD;
  v_inconsistent_stock_count INT := 0;
  v_unrenamed_legacy_tables TEXT[] := ARRAY[]::TEXT[];
  v_compat_views TEXT[] := ARRAY[]::TEXT[];
  v_tables_without_policies TEXT[] := ARRAY[]::TEXT[];
  v_user_prefs_policy_count INT := 0;
  v_has_user_prefs_table BOOLEAN := false;
  v_mail_tables_ok BOOLEAN := false;
  v_mail_rpcs_ok BOOLEAN := false;
  v_mail_config_service_only BOOLEAN := true;
BEGIN
  -- Contrôle d'accès strict : réservé aux rôles 0, 1 et 5 authentifiés (ou service_role / connexion directe postgres lors de l'installation CLI)
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_setting('role', true) = 'service_role'
     OR (
       COALESCE(NULLIF(trim(current_setting('request.jwt.claims', true)), ''), '') LIKE '{%'
       AND COALESCE((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') = 'service_role'
     )
     OR session_user = 'postgres' THEN
    v_caller_role := 0;
  ELSE
    SELECT role_id INTO v_caller_role
    FROM public.core_users
    WHERE auth_user_id = auth.uid()
      AND COALESCE(is_blocked, false) = false
    LIMIT 1;
  END IF;

  IF v_caller_role IS NULL OR v_caller_role NOT IN (0, 1, 5) THEN
    RAISE EXCEPTION 'Accès refusé : le diagnostic d''installation est réservé aux rôles 0, 1 et 5.'
      USING ERRCODE = '42501';
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 1 : Tables attendues présentes et RLS activé sur chacune
  -- -----------------------------------------------------------------------
  FOREACH v_tbl IN ARRAY v_expected_tables LOOP
    SELECT c.relrowsecurity INTO v_rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = v_tbl AND c.relkind = 'r';

    IF NOT FOUND THEN
      v_missing_tables := array_append(v_missing_tables, v_tbl);
    ELSIF COALESCE(v_rls_enabled, false) = false THEN
      v_no_rls_tables := array_append(v_no_rls_tables, v_tbl);
    END IF;
  END LOOP;

  IF array_length(v_missing_tables, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'tables_rls'::TEXT,
      'Tables attendues & RLS activé'::TEXT,
      'ERREUR'::TEXT,
      format('Tables absentes : %s', array_to_string(v_missing_tables, ', '))::TEXT;
  ELSIF array_length(v_no_rls_tables, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'tables_rls'::TEXT,
      'Tables attendues & RLS activé'::TEXT,
      'ERREUR'::TEXT,
      format('RLS désactivé sur : %s', array_to_string(v_no_rls_tables, ', '))::TEXT;
  ELSE
    RETURN QUERY SELECT
      'tables_rls'::TEXT,
      'Tables attendues & RLS activé'::TEXT,
      'OK'::TEXT,
      format('%s/%s tables présentes avec RLS actif', array_length(v_expected_tables, 1), array_length(v_expected_tables, 1))::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 2 : anon n'a aucun droit sur les tables sensibles ni sur les vues de compatibilité
  -- -----------------------------------------------------------------------
  FOREACH v_tbl IN ARRAY ARRAY[
    'core_users', 'core_user_preferences', 'core_license_config', 'core_password_resets',
    'core_mail_accounts', 'core_mail_senders', 'core_mail_log',
    'stk_movements', 'stk_products', 'stk_stock_levels',
    'stk_print_stations', 'stk_print_jobs', 'stk_inventory_audits', 'stk_inventory_audit_items'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_tbl
    ) THEN
      IF has_table_privilege('anon', 'public.' || quote_ident(v_tbl), 'SELECT, INSERT, UPDATE, DELETE') THEN
        v_anon_leaks := array_append(v_anon_leaks, v_tbl);
      END IF;
    END IF;
  END LOOP;

  IF array_length(v_anon_leaks, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'anon_privileges'::TEXT,
      'Révocation des droits anon (core_users, core_license_config, stk_movements, stk_products, stk_print_stations, stk_print_jobs, stk_inventory_audits)'::TEXT,
      'ERREUR'::TEXT,
      format('Droits anon encore actifs sur : %s', array_to_string(v_anon_leaks, ', '))::TEXT;
  ELSE
    RETURN QUERY SELECT
      'anon_privileges'::TEXT,
      'Révocation des droits anon (core_users, core_license_config, stk_movements, stk_products, stk_print_stations, stk_print_jobs, stk_inventory_audits)'::TEXT,
      'OK'::TEXT,
      'Aucun privilège accordé à anon sur les tables sensibles'::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 2b (v37) : Règles RLS permissives (public / anon USING (true) ou WITH CHECK (true))
  -- Hors tables explicitement publiques en lecture listées en clair : v_explicit_public_select_tables = ARRAY['core_app_compat']
  -- -----------------------------------------------------------------------
  FOR v_pol IN
    SELECT
      p.tablename,
      p.policyname,
      p.cmd,
      p.roles::text[] AS role_names
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND ('public' = ANY(p.roles::text[]) OR 'anon' = ANY(p.roles::text[]))
      AND (
        regexp_replace(LOWER(COALESCE(p.qual, '')), '[\s()]', '', 'g') = 'true'
        OR regexp_replace(LOWER(COALESCE(p.with_check, '')), '[\s()]', '', 'g') = 'true'
      )
      AND NOT (
        p.tablename = ANY(v_explicit_public_select_tables)
        AND p.cmd = 'SELECT'
        AND COALESCE(p.with_check, '') = ''
      )
    ORDER BY p.tablename ASC, p.policyname ASC
  LOOP
    v_permissive_policies := array_append(
      v_permissive_policies,
      format('%s."%s" (%s)', v_pol.tablename, v_pol.policyname, v_pol.cmd)
    );
    IF NOT (v_pol.tablename = ANY(v_permissive_tables)) THEN
      v_permissive_tables := array_append(v_permissive_tables, v_pol.tablename);
    END IF;
  END LOOP;

  IF array_length(v_permissive_policies, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'permissive_rls_policies'::TEXT,
      'Règles RLS permissives (public / anon USING true)'::TEXT,
      'ERREUR'::TEXT,
      format(
        'Table(s) exposée(s) [%s] via : %s — ré-exécutez 02_rls_hardening.sql et 05_rpc_admin_users.sql',
        array_to_string(v_permissive_tables, ', '),
        array_to_string(v_permissive_policies, ', ')
      )::TEXT;
  ELSE
    RETURN QUERY SELECT
      'permissive_rls_policies'::TEXT,
      'Règles RLS permissives (public / anon USING true)'::TEXT,
      'OK'::TEXT,
      format(
        'Aucune règle RLS permissive (public/anon USING true) hors lecture publique explicite (%s)',
        array_to_string(v_explicit_public_select_tables, ', ')
      )::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 2c (v43) : Tables sans règle d'accès (RLS activé et 0 politique dans pg_policies)
  -- (hors tables RPC-only stk_print_stations / stk_print_jobs et tables de sauvegarde %_backup_ids)
  -- -----------------------------------------------------------------------
  FOR v_tbl IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
      AND c.relname NOT IN ('stk_print_stations', 'stk_print_jobs', 'core_password_resets')
      AND c.relname NOT LIKE '%\_backup\_ids' ESCAPE '\'
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = c.relname
      )
    ORDER BY c.relname ASC
  LOOP
    v_tables_without_policies := array_append(v_tables_without_policies, v_tbl);
  END LOOP;

  IF array_length(v_tables_without_policies, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'tables_without_rls_policies'::TEXT,
      'Tables sans règle d''accès'::TEXT,
      'ERREUR'::TEXT,
      format(
        'Table(s) avec RLS activé mais 0 règle d''accès : %s — exécutez fix_inventory_audits.sql ou dist/install.sql',
        array_to_string(v_tables_without_policies, ', ')
      )::TEXT;
  ELSE
    RETURN QUERY SELECT
      'tables_without_rls_policies'::TEXT,
      'Tables sans règle d''accès'::TEXT,
      'OK'::TEXT,
      'Toutes les tables avec RLS activé disposent d''au moins une règle d''accès'::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 3 : Au moins un Super Administrateur (role_id = 0) lié à un compte Auth
  -- -----------------------------------------------------------------------
  SELECT COUNT(*) INTO v_super_admin_count
  FROM public.core_users
  WHERE role_id = 0
    AND auth_user_id IS NOT NULL
    AND COALESCE(is_blocked, false) = false;

  IF v_super_admin_count >= 1 THEN
    RETURN QUERY SELECT
      'super_admin_linked'::TEXT,
      'Super Administrateur (rôle 0) lié à Supabase Auth'::TEXT,
      'OK'::TEXT,
      format('%s compte(s) Super Administrateur actif(s) et lié(s)', v_super_admin_count)::TEXT;
  ELSE
    RETURN QUERY SELECT
      'super_admin_linked'::TEXT,
      'Super Administrateur (rôle 0) lié à Supabase Auth'::TEXT,
      'ERREUR'::TEXT,
      'Aucun Super Administrateur actif (role_id = 0) n''est lié à un compte Auth (auth_user_id IS NOT NULL)'::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 4 : Aucun PIN en clair restant dans core_users
  -- -----------------------------------------------------------------------
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'core_users' AND column_name = 'pin'
  ) INTO v_has_pin_col;

  IF v_has_pin_col THEN
    EXECUTE 'SELECT COUNT(*) FROM public.core_users WHERE pin IS NOT NULL AND TRIM(pin) <> '''''
      INTO v_plain_pin_count;
  END IF;

  IF v_plain_pin_count > 0 THEN
    RETURN QUERY SELECT
      'no_plaintext_pin'::TEXT,
      'Absence de code PIN en clair dans public.core_users'::TEXT,
      'ATTENTION'::TEXT,
      format('%s profil(s) contiennent encore une valeur dans la colonne pin', v_plain_pin_count)::TEXT;
  ELSE
    RETURN QUERY SELECT
      'no_plaintext_pin'::TEXT,
      'Absence de code PIN en clair dans public.core_users'::TEXT,
      'OK'::TEXT,
      'Aucun code PIN en clair stocké dans public.core_users'::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 5 : core_app_compat présente avec schema_version et min_app_version
  -- -----------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'core_app_compat'
  ) THEN
    SELECT schema_version, min_schema_version, min_app_version, maintenance
    INTO v_schema_ver, v_min_schema_ver, v_min_app_ver, v_maint
    FROM public.core_app_compat
    WHERE id = 1
    LIMIT 1;

    IF v_schema_ver IS NOT NULL AND TRIM(v_schema_ver) <> '' AND v_min_app_ver IS NOT NULL AND TRIM(v_min_app_ver) <> '' THEN
      RETURN QUERY SELECT
        'app_compat'::TEXT,
        'Table core_app_compat (schema_version & min_app_version)'::TEXT,
        CASE WHEN COALESCE(v_maint, false) THEN 'ATTENTION' ELSE 'OK' END::TEXT,
        format('schema_version=%s, min_schema_version=%s, min_app_version=%s, maintenance=%s',
          v_schema_ver, COALESCE(v_min_schema_ver, '1.0.0'), v_min_app_ver, COALESCE(v_maint, false))::TEXT;
    ELSE
      RETURN QUERY SELECT
        'app_compat'::TEXT,
        'Table core_app_compat (schema_version & min_app_version)'::TEXT,
        'ERREUR'::TEXT,
        'Ligne singleton id=1 absente ou versions non renseignées dans public.core_app_compat'::TEXT;
    END IF;
  ELSE
    RETURN QUERY SELECT
      'app_compat'::TEXT,
      'Table core_app_compat (schema_version & min_app_version)'::TEXT,
      'ERREUR'::TEXT,
      'Table public.core_app_compat absente'::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 6 : Licence valide (plan, modules, dépôts actifs / plafond)
  -- -----------------------------------------------------------------------
  BEGIN
    EXECUTE 'SELECT LOWER(COALESCE(plan_type, ''free'')), COALESCE(modules, ARRAY[''stock'']::TEXT[]), COALESCE(max_depots, 1) FROM public.core_license_config LIMIT 1'
      INTO v_lic_plan, v_lic_modules, v_lic_max_depots;
  EXCEPTION WHEN OTHERS THEN
    v_lic_plan := 'free';
    v_lic_modules := ARRAY['stock']::TEXT[];
    v_lic_max_depots := 1;
  END;

  v_limits := public.plan_limits(COALESCE(v_lic_plan, 'free'));
  v_lic_plan := COALESCE(v_limits->>'plan', 'free');
  IF v_lic_max_depots IS NULL OR v_lic_max_depots <= 0 THEN
    v_lic_max_depots := COALESCE((v_limits->>'max_depots')::int, 1);
  END IF;

  SELECT COUNT(*) INTO v_active_depots
  FROM public.stk_depots
  WHERE COALESCE(is_active, true) = true;

  IF v_active_depots > v_lic_max_depots AND v_lic_max_depots < 99999 THEN
    RETURN QUERY SELECT
      'license_status'::TEXT,
      'Licence & quota de dépôts actifs'::TEXT,
      'ATTENTION'::TEXT,
      format('Formule=%s | Modules=[%s] | Dépôts actifs=%s/%s (dépassement du plafond)',
        v_lic_plan, array_to_string(v_lic_modules, ', '), v_active_depots, v_lic_max_depots)::TEXT;
  ELSE
    RETURN QUERY SELECT
      'license_status'::TEXT,
      'Licence & quota de dépôts actifs'::TEXT,
      'OK'::TEXT,
      format('Formule=%s | Modules=[%s] | Dépôts actifs=%s/%s',
        v_lic_plan, array_to_string(v_lic_modules, ', '), v_active_depots,
        CASE WHEN v_lic_max_depots >= 99999 THEN 'illimité' ELSE v_lic_max_depots::text END)::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 7 : Fonctions sensibles non exécutables par anon
  -- -----------------------------------------------------------------------
  FOREACH v_fn IN ARRAY v_sensitive_funcs LOOP
    FOR v_fn_oid IN
      SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn
    LOOP
      IF has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
        v_exposed_funcs := array_append(v_exposed_funcs, v_fn);
      END IF;
    END LOOP;
  END LOOP;

  IF array_length(v_exposed_funcs, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'sensitive_functions'::TEXT,
      'Fonctions sensibles non exécutables par anon'::TEXT,
      'ERREUR'::TEXT,
      format('Exécutable(s) par anon : %s', array_to_string(v_exposed_funcs, ', '))::TEXT;
  ELSE
    RETURN QUERY SELECT
      'sensitive_functions'::TEXT,
      'Fonctions sensibles non exécutables par anon'::TEXT,
      'OK'::TEXT,
      'Toutes les fonctions sensibles sont interdites au rôle anon'::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 8 : Fonctions Edge déployées (APP_TOT-Stock_admin-users, APP_TOT-Stock_licenses_sync-license, APP_TOT-Stock_send-report-email)
  -- -----------------------------------------------------------------------
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_email_secret'
  ) INTO v_has_email_secret_fn;

  BEGIN
    SELECT value INTO v_edge_meta
    FROM public.core_app_settings
    WHERE key = 'edge_functions_deployed'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_edge_meta := NULL;
  END;

  IF v_edge_meta IS NOT NULL AND TRIM(v_edge_meta) <> '' THEN
    RETURN QUERY SELECT
      'edge_functions_deployed'::TEXT,
      'Fonctions Edge déployées'::TEXT,
      'OK'::TEXT,
      format('Fonctions déployées (APP_TOT-Stock_admin-users, APP_TOT-Stock_licenses_sync-license, APP_TOT-Stock_send-report-email, APP_TOT-Stock_password-reset) — %s', v_edge_meta)::TEXT;
  ELSIF v_has_email_secret_fn THEN
    RETURN QUERY SELECT
      'edge_functions_deployed'::TEXT,
      'Fonctions Edge déployées'::TEXT,
      'ATTENTION'::TEXT,
      'Prérequis SQL (get_email_secret, core_app_settings) prêts ; déploiement Edge Functions à vérifier via tot-install ou sonde HTTP'::TEXT;
  ELSE
    RETURN QUERY SELECT
      'edge_functions_deployed'::TEXT,
      'Fonctions Edge déployées'::TEXT,
      'ERREUR'::TEXT,
      'Fonction public.get_email_secret() absente (exécutez 02_rls_hardening.sql et déployez les fonctions Edge)'::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 9 : Impression à distance (08_print_jobs.sql : tables & RPC)
  -- -----------------------------------------------------------------------
  FOREACH v_fn IN ARRAY v_print_rpc_funcs LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn
    ) THEN
      v_missing_print_funcs := array_append(v_missing_print_funcs, v_fn);
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stk_print_stations'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stk_print_jobs'
  ) THEN
    RETURN QUERY SELECT
      'print_jobs_module'::TEXT,
      'Impression à distance (stk_print_stations, stk_print_jobs & RPC)'::TEXT,
      'ERREUR'::TEXT,
      'Tables stk_print_stations ou stk_print_jobs absentes (exécutez 08_print_jobs.sql)'::TEXT;
  ELSIF array_length(v_missing_print_funcs, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'print_jobs_module'::TEXT,
      'Impression à distance (stk_print_stations, stk_print_jobs & RPC)'::TEXT,
      'ERREUR'::TEXT,
      format('Fonctions RPC absentes : %s', array_to_string(v_missing_print_funcs, ', '))::TEXT;
  ELSE
    RETURN QUERY SELECT
      'print_jobs_module'::TEXT,
      'Impression à distance (stk_print_stations, stk_print_jobs & RPC)'::TEXT,
      'OK'::TEXT,
      format('Tables stk_print_stations & stk_print_jobs et %s/%s fonctions RPC présentes', array_length(v_print_rpc_funcs, 1), array_length(v_print_rpc_funcs, 1))::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 10 (v40) : Mouvements de stock (process_stock_movement 12 paramètres & table stk_stock_levels)
  -- -----------------------------------------------------------------------
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stk_stock_levels'
  ) INTO v_has_stock_levels_tbl;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'process_stock_movement'
      AND p.pronargs = 12
  ) INTO v_has_process_mov_12;

  IF v_has_stock_levels_tbl AND v_has_process_mov_12 THEN
    RETURN QUERY SELECT
      'stock_movements_rpc'::TEXT,
      'Mouvements de stock'::TEXT,
      'OK'::TEXT,
      'Fonction process_stock_movement (12 paramètres) et table stk_stock_levels actives'::TEXT;
  ELSE
    RETURN QUERY SELECT
      'stock_movements_rpc'::TEXT,
      'Mouvements de stock'::TEXT,
      'ERREUR'::TEXT,
      'Le serveur n''a pas la dernière version des scripts SQL (03, 04) : exécutez dist/install.sql'::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 11 (v41) : Déclencheurs inconnus sur les tables de stock
  -- -----------------------------------------------------------------------
  FOR v_trig IN
    SELECT t.tgname, c.relname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('stk_movements', 'stk_stock_levels', 'stk_products', 'stock_movements', 'stock_levels', 'movements', 'products')
      AND NOT t.tgisinternal
      AND t.tgname NOT IN (
        'trg_check_product_quantity_update',
        'trg_enforce_license_max_references',
        'trg_audit_stk_products',
        'trg_audit_row',
        'trg_block_closed_project_movements'
      )
    ORDER BY c.relname ASC, t.tgname ASC
  LOOP
    v_unknown_triggers := array_append(
      v_unknown_triggers,
      format('%s sur %s', v_trig.tgname, v_trig.relname)
    );
  END LOOP;

  IF array_length(v_unknown_triggers, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'unknown_stock_triggers'::TEXT,
      'Déclencheurs inconnus sur les tables de stock'::TEXT,
      'ERREUR'::TEXT,
      format('Déclencheur(s) hérité(s) détecté(s) : %s — exécutez 03_rpc_stock_and_orders.sql ou dist/install.sql', array_to_string(v_unknown_triggers, ', '))::TEXT;
  ELSE
    RETURN QUERY SELECT
      'unknown_stock_triggers'::TEXT,
      'Déclencheurs inconnus sur les tables de stock'::TEXT,
      'OK'::TEXT,
      'Aucun déclencheur inconnu sur stk_movements, stk_stock_levels et stk_products'::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 12 (v41) : Cohérence du stock (stk_products.quantity = somme de stk_stock_levels)
  -- -----------------------------------------------------------------------
  IF v_has_stock_levels_tbl THEN
    SELECT COUNT(*) INTO v_inconsistent_stock_count
    FROM (
      SELECT p.id
      FROM public.stk_products p
      LEFT JOIN public.stk_stock_levels sl ON sl.product_id::text = p.id::text
      GROUP BY p.id, p.quantity
      HAVING p.quantity IS DISTINCT FROM COALESCE(SUM(sl.quantity), 0)
    ) sub;

    IF v_inconsistent_stock_count > 0 THEN
      RETURN QUERY SELECT
        'stock_consistency'::TEXT,
        'Cohérence du stock'::TEXT,
        'ATTENTION'::TEXT,
        format('%s produit(s) ont un écart entre stk_products.quantity et la somme de stk_stock_levels', v_inconsistent_stock_count)::TEXT;
    ELSE
      RETURN QUERY SELECT
        'stock_consistency'::TEXT,
        'Cohérence du stock'::TEXT,
        'OK'::TEXT,
        'Tous les produits ont stk_products.quantity égal à la somme de stk_stock_levels'::TEXT;
    END IF;
  ELSE
    RETURN QUERY SELECT
      'stock_consistency'::TEXT,
      'Cohérence du stock'::TEXT,
      'ERREUR'::TEXT,
      'Table stk_stock_levels absente : impossible de vérifier la cohérence du stock par dépôt'::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 13 (v42) : Tables préfixées (core_ / stk_)
  -- OK si toutes les tables attendues core_/stk_ sont des tables physiques et qu'aucun ancien nom n'est encore une table physique.
  -- -----------------------------------------------------------------------
  FOREACH v_tbl IN ARRAY v_legacy_names LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_tbl AND c.relkind = 'r'
    ) THEN
      v_unrenamed_legacy_tables := array_append(v_unrenamed_legacy_tables, v_tbl);
    END IF;
  END LOOP;

  IF array_length(v_unrenamed_legacy_tables, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'prefixed_tables'::TEXT,
      'Tables préfixées (core_ / stk_)'::TEXT,
      'ERREUR'::TEXT,
      format('Ancien(s) nom(s) encore sous forme de table physique : %s — exécutez 09_core_prefixes.sql ou dist/install.sql', array_to_string(v_unrenamed_legacy_tables, ', '))::TEXT;
  ELSIF array_length(v_missing_tables, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'prefixed_tables'::TEXT,
      'Tables préfixées (core_ / stk_)'::TEXT,
      'ERREUR'::TEXT,
      format('Tables préfixées manquantes : %s', array_to_string(v_missing_tables, ', '))::TEXT;
  ELSE
    RETURN QUERY SELECT
      'prefixed_tables'::TEXT,
      'Tables préfixées (core_ / stk_)'::TEXT,
      'OK'::TEXT,
      'Toutes les tables physiques utilisent la nomenclature préfixée core_* et stk_* (schéma 2.0.0)'::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 14 (v42) : Vues de compatibilité d'anciens noms
  -- Signale en ATTENTION la présence de vues de compatibilité héritées (à supprimer via 10_drop_compat_views.sql une fois toutes les apps à jour).
  -- -----------------------------------------------------------------------
  FOREACH v_tbl IN ARRAY v_legacy_names LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_tbl AND c.relkind = 'v'
    ) THEN
      v_compat_views := array_append(v_compat_views, v_tbl);
    END IF;
  END LOOP;

  IF array_length(v_compat_views, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'compat_views_present'::TEXT,
      'Vues de compatibilité d''anciens noms'::TEXT,
      'ATTENTION'::TEXT,
      format('%s vue(s) de compatibilité active(s) (%s) — exécutez 10_drop_compat_views.sql une fois toutes les applications de la suite TOT mises à jour', array_length(v_compat_views, 1), array_to_string(v_compat_views, ', '))::TEXT;
  ELSE
    RETURN QUERY SELECT
      'compat_views_present'::TEXT,
      'Vues de compatibilité d''anciens noms'::TEXT,
      'OK'::TEXT,
      'Aucune vue de compatibilité héritée active'::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 15 (v48) : Table core_user_preferences et ses 4 politiques RLS
  -- -----------------------------------------------------------------------
  SELECT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'core_user_preferences'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
  ) INTO v_has_user_prefs_table;

  SELECT COUNT(*) INTO v_user_prefs_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'core_user_preferences';

  IF NOT v_has_user_prefs_table THEN
    RETURN QUERY SELECT
      'user_preferences_rls'::TEXT,
      'Préférences utilisateur (core_user_preferences & 4 politiques RLS)'::TEXT,
      'ERREUR'::TEXT,
      'Table public.core_user_preferences absente ou RLS désactivé — exécutez 12_user_preferences.sql'::TEXT;
  ELSIF v_user_prefs_policy_count < 4 THEN
    RETURN QUERY SELECT
      'user_preferences_rls'::TEXT,
      'Préférences utilisateur (core_user_preferences & 4 politiques RLS)'::TEXT,
      'ERREUR'::TEXT,
      format('Politiques RLS incomplètes sur core_user_preferences (%s/4) — exécutez 12_user_preferences.sql', v_user_prefs_policy_count)::TEXT;
  ELSE
    RETURN QUERY SELECT
      'user_preferences_rls'::TEXT,
      'Préférences utilisateur (core_user_preferences & 4 politiques RLS)'::TEXT,
      'OK'::TEXT,
      format('Table core_user_preferences présente avec RLS actif et %s politiques (SELECT, INSERT, UPDATE, DELETE)', v_user_prefs_policy_count)::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 16 (v49) : RPC transfer_stock_batch (transfert inter-dépôts par lot)
  -- -----------------------------------------------------------------------
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'transfer_stock_batch'
      AND p.pronargs = 5
  ) INTO v_has_transfer_batch_fn;

  IF v_has_transfer_batch_fn THEN
    RETURN QUERY SELECT
      'transfer_stock_batch_rpc'::TEXT,
      'Transfert de matériel entre dépôts par lot (transfer_stock_batch)'::TEXT,
      'OK'::TEXT,
      'Fonction public.transfer_stock_batch (5 paramètres) active et protégée'::TEXT;
  ELSE
    RETURN QUERY SELECT
      'transfer_stock_batch_rpc'::TEXT,
      'Transfert de matériel entre dépôts par lot (transfer_stock_batch)'::TEXT,
      'ERREUR'::TEXT,
      'Fonction public.transfer_stock_batch absente — exécutez 13_transfer_stock_batch.sql ou dist/install.sql'::TEXT;
  END IF;
  -- -----------------------------------------------------------------------
  -- Contrôle 17 (v50 / v51) : Mailing multi-fournisseurs (dont msgraph) & expéditeur par application (14_mailing.sql)
  -- -----------------------------------------------------------------------
  SELECT (
    EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'core_mail_accounts' AND c.relkind = 'r' AND c.relrowsecurity = true
    )
    AND EXISTS (
      SELECT 1 FROM pg_constraint cc
      JOIN pg_class ct ON ct.oid = cc.conrelid
      JOIN pg_namespace cn ON cn.oid = ct.relnamespace
      WHERE cn.nspname = 'public'
        AND ct.relname = 'core_mail_accounts'
        AND cc.conname = 'core_mail_accounts_provider_chk'
        AND pg_get_constraintdef(cc.oid) LIKE '%msgraph%'
    )
    AND EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'core_mail_senders' AND c.relkind = 'r' AND c.relrowsecurity = true
    )
    AND EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'core_mail_log' AND c.relkind = 'r' AND c.relrowsecurity = true
    )
  ) INTO v_mail_tables_ok;

  SELECT (
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'get_mail_config'
    )
    AND EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'set_mail_account_secret'
    )
    AND EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'mail_account_has_secret'
    )
    AND EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'purge_mail_log'
    )
  ) INTO v_mail_rpcs_ok;

  FOR v_fn_oid IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_mail_config'
  LOOP
    IF has_function_privilege('authenticated', v_fn_oid, 'EXECUTE')
       OR has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
      v_mail_config_service_only := false;
    END IF;
  END LOOP;

  IF NOT v_mail_tables_ok THEN
    RETURN QUERY SELECT
      'mailing_module'::TEXT,
      'Mailing multi-fournisseurs (core_mail_accounts, core_mail_senders, core_mail_log)'::TEXT,
      'ERREUR'::TEXT,
      'Tables core_mail_accounts, core_mail_senders ou core_mail_log absentes ou sans RLS — exécutez 14_mailing.sql'::TEXT;
  ELSIF NOT v_mail_rpcs_ok THEN
    RETURN QUERY SELECT
      'mailing_module'::TEXT,
      'Mailing multi-fournisseurs (core_mail_accounts, core_mail_senders, core_mail_log)'::TEXT,
      'ERREUR'::TEXT,
      'Fonctions RPC mailing absentes (get_mail_config, set_mail_account_secret) — exécutez 14_mailing.sql'::TEXT;
  ELSIF NOT v_mail_config_service_only THEN
    RETURN QUERY SELECT
      'mailing_module'::TEXT,
      'Mailing multi-fournisseurs (core_mail_accounts, core_mail_senders, core_mail_log)'::TEXT,
      'ERREUR'::TEXT,
      'Fonction get_mail_config exposée à authenticated ou anon — exécutez 14_mailing.sql et 07_app_compat.sql'::TEXT;
  ELSE
    RETURN QUERY SELECT
      'mailing_module'::TEXT,
      'Mailing multi-fournisseurs (core_mail_accounts, core_mail_senders, core_mail_log)'::TEXT,
      'OK'::TEXT,
      'Tables core_mail_accounts (avec msgraph), core_mail_senders, core_mail_log (RLS actif) et RPC get_mail_config / set_mail_account_secret conformes'::TEXT;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.diagnostic_installation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diagnostic_installation() TO authenticated, service_role;

-- =========================================================================
-- 4. DURCISSEMENT FINAL : aucune fonction SECURITY DEFINER exécutable par anon
-- (Supabase accorde EXECUTE à anon par défaut sur les nouvelles fonctions du schéma public.)
-- Ce bloc est rejouable et doit rester en fin de script 07.
-- =========================================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_tot_refresh_compat_views'
  ) THEN
    PERFORM public._tot_refresh_compat_views();
  END IF;

  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    IF r.proname = 'log_login_failure' THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', r.sig);
    ELSE
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
      IF r.proname IN (
        'get_email_secret',
        'get_mail_config',
        '_tot_write_mail_vault_secret',
        '_tot_read_mail_vault_secret',
        'sync_verified_license_token',
        'purge_expired_password_resets'
      ) THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
      ELSE
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
      END IF;
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

