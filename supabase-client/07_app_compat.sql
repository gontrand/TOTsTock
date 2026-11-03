-- =========================================================================
-- TOT STOCK - SCRIPT 07 : COMPATIBILITÉ APPLICATION, SCHÉMA & DIAGNOSTIC (07_app_compat.sql)
-- Définit is_active_admin(), la table singleton public.app_compat (avec min_schema_version)
-- et la fonction RPC public.diagnostic_installation() réservée aux rôles 0, 1 et 5.
-- Rejouable : oui
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. VÉRIFICATION DES PRÉREQUIS (Point 3)
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (07_app_compat.sql) : La table public.users est absente. Exécutez d''abord les scripts 01 à 06.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'auth_user_id'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (07_app_compat.sql) : La colonne public.users.auth_user_id est absente. Exécutez d''abord 01_auth_link.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'license_config'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (07_app_compat.sql) : La table public.license_config est absente. Exécutez d''abord 02_rls_hardening.sql.';
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
    SELECT 1 FROM public.users 
    WHERE (auth_user_id = auth.uid() OR id::text = auth.uid()::text)
      AND COALESCE(is_blocked, false) = false 
      AND role_id IN (0, 1)
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_admin() TO authenticated;

-- =========================================================================
-- 2. TOT STOCK : TABLE DE COMPATIBILITÉ & MODE MAINTENANCE (app_compat) (Point 4 & 6)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.app_compat (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  schema_version     TEXT NOT NULL DEFAULT '1.0.0',
  min_schema_version TEXT NOT NULL DEFAULT '1.0.0',
  min_app_version    TEXT NOT NULL DEFAULT '1.0.0',
  latest_version     TEXT,                          -- Optionnel : notification MAJ non bloquante
  update_url         TEXT,                          -- Optionnel : lien APK / store / web
  maintenance        BOOLEAN NOT NULL DEFAULT false,-- Coupe-circuit pendant les migrations SQL
  message            TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ajout additif et idempotent des colonnes (dont min_schema_version requis au Point 4)
ALTER TABLE public.app_compat
  ADD COLUMN IF NOT EXISTS min_schema_version TEXT NOT NULL DEFAULT '1.0.0',
  ADD COLUMN IF NOT EXISTS latest_version TEXT,
  ADD COLUMN IF NOT EXISTS update_url TEXT,
  ADD COLUMN IF NOT EXISTS maintenance BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Activation du RLS
ALTER TABLE public.app_compat ENABLE ROW LEVEL SECURITY;

-- Lecture publique (permet le check avant le login)
DROP POLICY IF EXISTS "Lecture de la compatibilité" ON public.app_compat;
CREATE POLICY "Lecture de la compatibilité" ON public.app_compat
  FOR SELECT TO anon, authenticated
  USING (true);

GRANT SELECT ON TABLE public.app_compat TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.app_compat FROM anon, PUBLIC;

-- Modification réservée aux administrateurs actifs (via is_active_admin())
DROP POLICY IF EXISTS "Modification compatibilité admin" ON public.app_compat;
CREATE POLICY "Modification compatibilité admin" ON public.app_compat
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

DROP TRIGGER IF EXISTS trg_app_compat_updated_at ON public.app_compat;
CREATE TRIGGER trg_app_compat_updated_at
  BEFORE UPDATE ON public.app_compat
  FOR EACH ROW
  EXECUTE FUNCTION public.set_app_compat_updated_at();

-- Initialisation de la configuration par défaut (singleton id=1)
-- v30 : schema_version passe à 1.1.0, min_schema_version reste à 1.0.0 pour tolérer les clients N-1
INSERT INTO public.app_compat (id, schema_version, min_schema_version, min_app_version, latest_version, message)
VALUES (1, '1.1.0', '1.0.0', '1.0.0', '5.5.0', NULL)
ON CONFLICT (id) DO UPDATE
SET schema_version = '1.1.0',
    min_schema_version = COALESCE(NULLIF(TRIM(public.app_compat.min_schema_version), ''), '1.0.0'),
    latest_version = COALESCE(public.app_compat.latest_version, '5.5.0');

-- =========================================================================
-- 3. DIAGNOSTIC D'INSTALLATION (Point 7)
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
    'roles', 'departments', 'users', 'projects', 'sub_categories',
    'depots', 'products', 'movements', 'stock_movements', 'material_orders',
    'app_settings', 'audit_logs', 'license_config', 'app_compat',
    'print_stations', 'print_jobs'
  ];
  v_tbl TEXT;
  v_missing_tables TEXT[] := ARRAY[]::TEXT[];
  v_no_rls_tables TEXT[] := ARRAY[]::TEXT[];
  v_rls_enabled BOOLEAN;
  v_anon_leaks TEXT[] := ARRAY[]::TEXT[];
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
    'get_email_secret',
    'register_print_station',
    'list_print_stations',
    'create_print_job',
    'claim_print_jobs',
    'complete_print_job',
    'cancel_print_job',
    'purge_print_jobs',
    'get_print_job_status',
    'list_station_print_jobs'
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
BEGIN
  -- Contrôle d'accès strict : réservé aux rôles 0, 1 et 5 authentifiés (ou service_role / connexion directe postgres lors de l'installation CLI ; current_user serait toujours postgres dans une fonction SECURITY DEFINER, d'où session_user)
  IF current_setting('request.jwt.claim.role', true) = 'service_role' OR session_user = 'postgres' THEN
    v_caller_role := 0;
  ELSE
    SELECT role_id INTO v_caller_role
    FROM public.users
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
  -- Contrôle 2 : anon n'a aucun droit sur users, license_config, movements, products, print_stations, print_jobs
  -- -----------------------------------------------------------------------
  FOREACH v_tbl IN ARRAY ARRAY['users', 'license_config', 'movements', 'products', 'print_stations', 'print_jobs'] LOOP
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
      'Révocation des droits anon (users, license_config, movements, products, print_stations, print_jobs)'::TEXT,
      'ERREUR'::TEXT,
      format('Droits anon encore actifs sur : %s', array_to_string(v_anon_leaks, ', '))::TEXT;
  ELSE
    RETURN QUERY SELECT
      'anon_privileges'::TEXT,
      'Révocation des droits anon (users, license_config, movements, products, print_stations, print_jobs)'::TEXT,
      'OK'::TEXT,
      'Aucun privilège accordé à anon sur les tables sensibles'::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 3 : Au moins un Super Administrateur (role_id = 0) lié à un compte Auth
  -- -----------------------------------------------------------------------
  SELECT COUNT(*) INTO v_super_admin_count
  FROM public.users
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
  -- Contrôle 4 : Aucun PIN en clair restant dans users
  -- -----------------------------------------------------------------------
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'pin'
  ) INTO v_has_pin_col;

  IF v_has_pin_col THEN
    EXECUTE 'SELECT COUNT(*) FROM public.users WHERE pin IS NOT NULL AND TRIM(pin) <> '''''
      INTO v_plain_pin_count;
  END IF;

  IF v_plain_pin_count > 0 THEN
    RETURN QUERY SELECT
      'no_plaintext_pin'::TEXT,
      'Absence de code PIN en clair dans public.users'::TEXT,
      'ATTENTION'::TEXT,
      format('%s profil(s) contiennent encore une valeur dans la colonne pin', v_plain_pin_count)::TEXT;
  ELSE
    RETURN QUERY SELECT
      'no_plaintext_pin'::TEXT,
      'Absence de code PIN en clair dans public.users'::TEXT,
      'OK'::TEXT,
      'Aucun code PIN en clair stocké dans public.users'::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 5 : app_compat présente avec schema_version et min_app_version
  -- -----------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'app_compat'
  ) THEN
    SELECT schema_version, min_schema_version, min_app_version, maintenance
    INTO v_schema_ver, v_min_schema_ver, v_min_app_ver, v_maint
    FROM public.app_compat
    WHERE id = 1
    LIMIT 1;

    IF v_schema_ver IS NOT NULL AND TRIM(v_schema_ver) <> '' AND v_min_app_ver IS NOT NULL AND TRIM(v_min_app_ver) <> '' THEN
      RETURN QUERY SELECT
        'app_compat'::TEXT,
        'Table app_compat (schema_version & min_app_version)'::TEXT,
        CASE WHEN COALESCE(v_maint, false) THEN 'ATTENTION' ELSE 'OK' END::TEXT,
        format('schema_version=%s, min_schema_version=%s, min_app_version=%s, maintenance=%s',
          v_schema_ver, COALESCE(v_min_schema_ver, '1.0.0'), v_min_app_ver, COALESCE(v_maint, false))::TEXT;
    ELSE
      RETURN QUERY SELECT
        'app_compat'::TEXT,
        'Table app_compat (schema_version & min_app_version)'::TEXT,
        'ERREUR'::TEXT,
        'Ligne singleton id=1 absente ou versions non renseignées dans public.app_compat'::TEXT;
    END IF;
  ELSE
    RETURN QUERY SELECT
      'app_compat'::TEXT,
      'Table app_compat (schema_version & min_app_version)'::TEXT,
      'ERREUR'::TEXT,
      'Table public.app_compat absente'::TEXT;
  END IF;

  -- -----------------------------------------------------------------------
  -- Contrôle 6 : Licence valide (plan, modules, dépôts actifs / plafond)
  -- -----------------------------------------------------------------------
  BEGIN
    EXECUTE 'SELECT LOWER(COALESCE(plan_type, ''free'')), COALESCE(modules, ARRAY[''stock'']::TEXT[]), COALESCE(max_depots, 1) FROM public.license_config LIMIT 1'
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
  FROM public.depots
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
  -- Contrôle 8 : Fonctions Edge déployées (admin-users, sync-license, send-report-email)
  -- -----------------------------------------------------------------------
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_email_secret'
  ) INTO v_has_email_secret_fn;

  BEGIN
    SELECT value INTO v_edge_meta
    FROM public.app_settings
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
      format('Fonctions déployées (admin-users, sync-license, send-report-email) — %s', v_edge_meta)::TEXT;
  ELSIF v_has_email_secret_fn THEN
    RETURN QUERY SELECT
      'edge_functions_deployed'::TEXT,
      'Fonctions Edge déployées'::TEXT,
      'ATTENTION'::TEXT,
      'Prérequis SQL (get_email_secret, app_settings) prêts ; déploiement Edge Functions à vérifier via tot-install ou sonde HTTP'::TEXT;
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
    WHERE table_schema = 'public' AND table_name = 'print_stations'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'print_jobs'
  ) THEN
    RETURN QUERY SELECT
      'print_jobs_module'::TEXT,
      'Impression à distance (print_stations, print_jobs & RPC)'::TEXT,
      'ERREUR'::TEXT,
      'Tables print_stations ou print_jobs absentes (exécutez 08_print_jobs.sql)'::TEXT;
  ELSIF array_length(v_missing_print_funcs, 1) IS NOT NULL THEN
    RETURN QUERY SELECT
      'print_jobs_module'::TEXT,
      'Impression à distance (print_stations, print_jobs & RPC)'::TEXT,
      'ERREUR'::TEXT,
      format('Fonctions RPC absentes : %s', array_to_string(v_missing_print_funcs, ', '))::TEXT;
  ELSE
    RETURN QUERY SELECT
      'print_jobs_module'::TEXT,
      'Impression à distance (print_stations, print_jobs & RPC)'::TEXT,
      'OK'::TEXT,
      format('Tables print_stations & print_jobs et %s/%s fonctions RPC présentes', array_length(v_print_rpc_funcs, 1), array_length(v_print_rpc_funcs, 1))::TEXT;
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
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
