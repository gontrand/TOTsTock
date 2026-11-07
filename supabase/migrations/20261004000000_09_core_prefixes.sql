-- =========================================================================
-- FICHIER GÉNÉRÉ AUTOMATIQUEMENT PAR scripts/build-sql.mjs — NE PAS MODIFIER DIRECTEMENT
-- Source de vérité : supabase-client/09_core_prefixes.sql
-- Étape 09 : Renommage idempotent des tables vers core_* et stk_* + vues de compatibilité
-- =========================================================================
-- =========================================================================
-- TOT STOCK - SCRIPT 09 : PRÉFIXES DE TABLES POUR LA SUITE TOT (09_core_prefixes.sql)
-- Description : Renommage idempotent des tables vers core_* (partagé suite TOT) et stk_* (TOT Stock),
--   prise en charge de l'ancienne table movements, ajout de la colonne app ('stock')
--   sur core_audit_logs et core_processed_operations, et création des vues de
--   compatibilité (WITH (security_invoker = true)) pour les bases migrées.
-- Dépendances : 00_complete_tot_stock_schema.sql (ou base existante v1.x)
-- Ordre d'exécution : Exécuté après 00 (ou 01) et avant 02_rls_hardening.sql
-- Rejouable : oui (idempotent)
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. DÉTECTION DE BASE ANCIENNE & RETRAIT TEMPORAIRE DES VUES DE COMPATIBILITÉ
-- (Sur une base neuve où aucune ancienne table ni vue de compatibilité n'existe,
-- aucune vue de compatibilité ne sera créée en fin de script.)
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_legacy_names TEXT[] := ARRAY[
    'users', 'roles', 'departments', 'projects',
    'company_settings', 'app_settings', 'license_config', 'app_compat',
    'audit_logs', 'login_logs', 'processed_operations', 'files',
    'products', 'categories', 'sub_categories', 'stock_levels',
    'depots', 'stock_movements', 'movements',
    'material_orders', 'material_order_items',
    'print_jobs', 'print_stations',
    'inventory_audits', 'inventory_audit_items', 'order_preparations_log'
  ];
  v_name TEXT;
  v_has_legacy_base BOOLEAN := false;
  v_has_compat_view BOOLEAN := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY(v_legacy_names)
      AND c.relkind = 'r'
  ) INTO v_has_legacy_base;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY(v_legacy_names)
      AND c.relkind = 'v'
  ) INTO v_has_compat_view;

  IF v_has_legacy_base OR v_has_compat_view THEN
    PERFORM set_config('tot.enable_compat_views', 'on', false);
  END IF;

  -- Si des vues de compatibilité existent déjà (rejeu), on les retire temporairement
  -- pour ne jamais bloquer l'alignement des types de colonnes.
  IF v_has_compat_view THEN
    FOREACH v_name IN ARRAY v_legacy_names LOOP
      IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = v_name AND c.relkind = 'v'
      ) THEN
        EXECUTE format('DROP VIEW IF EXISTS public.%I', v_name);
      END IF;
    END LOOP;
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 2. PURGE DES RÈGLES RLS SUR LES ANCIENNES ET NOUVELLES TABLES
-- -------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'users', 'roles', 'departments', 'projects',
        'company_settings', 'app_settings', 'license_config', 'app_compat',
        'audit_logs', 'login_logs', 'processed_operations', 'files',
        'products', 'categories', 'sub_categories', 'stock_levels',
        'depots', 'stock_movements', 'movements',
        'material_orders', 'material_order_items',
        'print_jobs', 'print_stations',
        'inventory_audits', 'inventory_audit_items', 'order_preparations_log',
        'core_users', 'core_roles', 'core_departments', 'core_projects',
        'core_company_settings', 'core_app_settings', 'core_license_config', 'core_app_compat',
        'core_audit_logs', 'core_login_logs', 'core_processed_operations', 'core_files',
        'stk_products', 'stk_categories', 'stk_sub_categories', 'stk_stock_levels',
        'stk_depots', 'stk_movements',
        'stk_material_orders', 'stk_material_order_items',
        'stk_print_jobs', 'stk_print_stations',
        'stk_inventory_audits', 'stk_inventory_audit_items', 'stk_order_preparations_log'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 3. PURGE DES DÉCLENCHEURS HÉRITÉS SUR LES TABLES DE STOCK ET UTILISATEURS
--    (Exécuté avant la conversion de type des colonnes id pour éviter tout blocage)
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_allowed_triggers TEXT[] := ARRAY[
    'trg_check_product_quantity_update',
    'trg_enforce_license_max_references',
    'trg_sync_app_to_company',
    'trg_sync_company_to_app',
    'trg_check_material_orders_update',
    'trg_enforce_license_max_depots',
    'trg_app_compat_updated_at',
    'trg_on_auth_user_created',
    'trg_on_auth_user_email_confirmed'
  ];
  r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'stock_movements' AND c.relkind = 'r'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_process_stock_movement ON public.stock_movements';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'stk_movements' AND c.relkind = 'r'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_process_stock_movement ON public.stk_movements';
  END IF;

  DROP FUNCTION IF EXISTS public.process_stock_movement();

  FOR r IN
    SELECT t.tgname, c.relname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN (
        'stock_movements', 'stock_levels', 'movements', 'products',
        'stk_movements', 'stk_stock_levels', 'stk_products'
      )
      AND NOT t.tgisinternal
      AND NOT (t.tgname = ANY(v_allowed_triggers))
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', r.tgname, r.relname);
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 4. CONVERSION DES COLONNES id NUMÉRIQUES / IDENTITY VERS TEXT (AVANT RENOMMAGE)
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_tbl TEXT;
  v_type TEXT;
  v_identity TEXT;
  v_dep_obj TEXT;
  v_err_msg TEXT;
  v_err_detail TEXT;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'stock_movements', 'movements', 'audit_logs', 'stock_levels',
    'stk_movements', 'core_audit_logs', 'stk_stock_levels'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_tbl AND c.relkind = 'r'
    ) THEN
      SELECT data_type, is_identity INTO v_type, v_identity
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_tbl AND column_name = 'id';

      IF v_type IS NOT NULL AND v_type <> 'text' THEN
        SELECT c.conname || ' sur ' || c.conrelid::regclass::text
        INTO v_dep_obj
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = ANY(c.confkey)
        WHERE c.confrelid = format('public.%I', v_tbl)::regclass
          AND c.contype = 'f'
          AND a.attname = 'id'
        LIMIT 1;

        IF v_dep_obj IS NOT NULL THEN
          RAISE EXCEPTION 'conversion impossible : %', v_dep_obj;
        END IF;

        BEGIN
          EXECUTE format('CREATE TABLE IF NOT EXISTS public.%I AS TABLE public.%I', v_tbl || '_backup_ids', v_tbl);
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl || '_backup_ids');
          EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_tbl || '_backup_ids');
          IF v_identity = 'YES' THEN
            EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id DROP IDENTITY', v_tbl);
          END IF;
          EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id DROP DEFAULT', v_tbl);
          EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id TYPE text USING id::text', v_tbl);
          EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT gen_random_uuid()::text', v_tbl);
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT, v_err_detail = PG_EXCEPTION_DETAIL;
          RAISE EXCEPTION 'conversion impossible : %', COALESCE(NULLIF(v_err_detail, ''), v_err_msg);
        END;
      END IF;
    END IF;
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 5. RENOMMAGE IDEMPOTENT DES TABLES VERS core_* ET stk_*
--    + FUSION/PRISE EN CHARGE DE L'ANCIENNE TABLE movements
--    (Les tables absentes comme files ou categories ne sont PAS créées.)
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_pair RECORD;
  v_old_is_table BOOLEAN;
  v_new_is_table BOOLEAN;
BEGIN
  FOR v_pair IN
    SELECT * FROM (
      VALUES
        -- Tables partagées Suite TOT (core_)
        ('roles', 'core_roles'),
        ('departments', 'core_departments'),
        ('users', 'core_users'),
        ('projects', 'core_projects'),
        ('company_settings', 'core_company_settings'),
        ('app_settings', 'core_app_settings'),
        ('license_config', 'core_license_config'),
        ('app_compat', 'core_app_compat'),
        ('audit_logs', 'core_audit_logs'),
        ('login_logs', 'core_login_logs'),
        ('processed_operations', 'core_processed_operations'),
        ('files', 'core_files'),
        -- Tables TOT Stock (stk_)
        ('sub_categories', 'stk_sub_categories'),
        ('categories', 'stk_categories'),
        ('depots', 'stk_depots'),
        ('products', 'stk_products'),
        ('stock_levels', 'stk_stock_levels'),
        ('stock_movements', 'stk_movements'),
        ('movements', 'stk_movements'),
        ('material_orders', 'stk_material_orders'),
        ('material_order_items', 'stk_material_order_items'),
        ('print_stations', 'stk_print_stations'),
        ('print_jobs', 'stk_print_jobs'),
        ('inventory_audits', 'stk_inventory_audits'),
        ('inventory_audit_items', 'stk_inventory_audit_items'),
        ('order_preparations_log', 'stk_order_preparations_log')
    ) AS t(old_name, new_name)
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_pair.old_name AND c.relkind = 'r'
    ) INTO v_old_is_table;

    SELECT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_pair.new_name AND c.relkind = 'r'
    ) INTO v_new_is_table;

    IF v_old_is_table AND NOT v_new_is_table THEN
      -- Si une vue portait le nouveau nom, la supprimer avant renommage
      EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', v_pair.new_name);
      EXECUTE format('ALTER TABLE public.%I RENAME TO %I', v_pair.old_name, v_pair.new_name);
    ELSIF v_old_is_table AND v_new_is_table THEN
      IF v_pair.old_name = 'movements' AND v_pair.new_name = 'stk_movements' THEN
        -- Les deux tables stock_movements (déjà renommée en stk_movements) et movements existaient :
        -- on fusionne les lignes éventuelles de movements absentes de stk_movements puis on supprime la table movements
        ALTER TABLE public.stk_movements
          ADD COLUMN IF NOT EXISTS product_ref TEXT,
          ADD COLUMN IF NOT EXISTS user_id TEXT,
          ADD COLUMN IF NOT EXISTS user_name TEXT,
          ADD COLUMN IF NOT EXISTS reason TEXT,
          ADD COLUMN IF NOT EXISTS site_number TEXT,
          ADD COLUMN IF NOT EXISTS department_name TEXT,
          ADD COLUMN IF NOT EXISTS depot_name TEXT,
          ADD COLUMN IF NOT EXISTS dest_depot_name TEXT,
          ADD COLUMN IF NOT EXISTS total_cost NUMERIC(12,2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS order_number TEXT,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

        ALTER TABLE public.movements
          ADD COLUMN IF NOT EXISTS product_id TEXT,
          ADD COLUMN IF NOT EXISTS product_ref TEXT,
          ADD COLUMN IF NOT EXISTS user_id TEXT,
          ADD COLUMN IF NOT EXISTS user_name TEXT,
          ADD COLUMN IF NOT EXISTS movement_type TEXT,
          ADD COLUMN IF NOT EXISTS quantity_changed NUMERIC(12,2),
          ADD COLUMN IF NOT EXISTS site_number TEXT,
          ADD COLUMN IF NOT EXISTS department_name TEXT,
          ADD COLUMN IF NOT EXISTS depot_name TEXT,
          ADD COLUMN IF NOT EXISTS dest_depot_name TEXT,
          ADD COLUMN IF NOT EXISTS total_cost NUMERIC(12,2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS order_number TEXT,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

        BEGIN
          INSERT INTO public.stk_movements (
            id, product_id, product_ref, user_id, user_name, movement_type,
            quantity_changed, site_number, department_name, depot_name, dest_depot_name,
            total_cost, order_number, created_at
          )
          SELECT
            m.id::text, m.product_id, m.product_ref, m.user_id, m.user_name, m.movement_type,
            m.quantity_changed, m.site_number, m.department_name, m.depot_name, m.dest_depot_name,
            COALESCE(m.total_cost, 0), m.order_number, COALESCE(m.created_at, now())
          FROM public.movements m
          WHERE m.product_id IS NOT NULL
            AND m.movement_type IS NOT NULL
            AND m.quantity_changed IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.stk_movements s WHERE s.id::text = m.id::text
            );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;

        DROP TABLE public.movements CASCADE;
      ELSE
        -- Cas où 00_complete_tot_stock_schema.sql a créé une table vide new_name avant 09 sur une base ancienne :
        -- on remplace la table nouvellement créée par l'ancienne table contenant les données historiques
        EXECUTE format('DROP TABLE public.%I CASCADE', v_pair.new_name);
        EXECUTE format('ALTER TABLE public.%I RENAME TO %I', v_pair.old_name, v_pair.new_name);
      END IF;
    END IF;
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 6. COLONNE app TEXT DEFAULT 'stock' SUR core_audit_logs ET core_processed_operations
--    + COLONNES MINIMALES SUR core_users ET MISE À JOUR DE handle_auth_user_created()
-- -------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.core_audit_logs
  ADD COLUMN IF NOT EXISTS app TEXT DEFAULT 'stock';

ALTER TABLE IF EXISTS public.core_processed_operations
  ADD COLUMN IF NOT EXISTS app TEXT DEFAULT 'stock';

DO $$
DECLARE
  v_uid_type TEXT;
  v_uid_identity TEXT;
  v_compat_id_type TEXT;
  v_compat_identity TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'core_users' AND c.relkind = 'r'
  ) THEN
    ALTER TABLE public.core_users
      ADD COLUMN IF NOT EXISTS name TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS pin TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS pin_hash TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_preparer BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS allowed_depots TEXT[] DEFAULT '{}'::TEXT[],
      ADD COLUMN IF NOT EXISTS department TEXT DEFAULT 'Général',
      ADD COLUMN IF NOT EXISTS trigram TEXT,
      ADD COLUMN IF NOT EXISTS role_id BIGINT DEFAULT 4,
      ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

    SELECT data_type, is_identity INTO v_uid_type, v_uid_identity
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'core_users' AND column_name = 'id';

    IF v_uid_type IS NOT NULL AND v_uid_type <> 'text' THEN
      BEGIN
        IF v_uid_identity = 'YES' THEN
          ALTER TABLE public.core_users ALTER COLUMN id DROP IDENTITY;
        END IF;
        ALTER TABLE public.core_users ALTER COLUMN id DROP DEFAULT;
        ALTER TABLE public.core_users ALTER COLUMN id TYPE TEXT USING id::text;
        ALTER TABLE public.core_users ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END IF;

  -- Si core_app_compat vient d'une ancienne table app_compat dont id n'était pas entier, aligner id sur INT
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'core_app_compat' AND c.relkind = 'r'
  ) THEN
    SELECT data_type, is_identity INTO v_compat_id_type, v_compat_identity
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'core_app_compat' AND column_name = 'id';

    IF v_compat_id_type IS NOT NULL AND v_compat_id_type NOT IN ('integer', 'bigint', 'smallint') THEN
      BEGIN
        IF v_compat_identity = 'YES' THEN
          ALTER TABLE public.core_app_compat ALTER COLUMN id DROP IDENTITY;
        END IF;
        ALTER TABLE public.core_app_compat ALTER COLUMN id DROP DEFAULT;
        DELETE FROM public.core_app_compat;
        ALTER TABLE public.core_app_compat ALTER COLUMN id TYPE INT USING 1;
        ALTER TABLE public.core_app_compat ALTER COLUMN id SET DEFAULT 1;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_auth_user_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_masked_email TEXT;
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.core_users
    SET auth_user_id = NEW.id,
        updated_at = now()
    WHERE auth_user_id IS NULL
      AND LOWER(TRIM(email)) = LOWER(TRIM(NEW.email));
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    v_masked_email := CASE
      WHEN NEW.email IS NULL OR position('@' IN NEW.email) = 0 THEN '***'
      ELSE left(split_part(NEW.email, '@', 1), 2) || '***@' || split_part(NEW.email, '@', 2)
    END;

    INSERT INTO public.core_audit_logs (
      id,
      app,
      user_id,
      action,
      severity,
      details,
      created_at
    ) VALUES (
      gen_random_uuid()::text,
      'stock',
      NEW.id::text,
      'AUTH_LINK_FAILED',
      'ERROR',
      jsonb_build_object(
        'error', SQLERRM,
        'sqlstate', SQLSTATE,
        'masked_email', v_masked_email
      ),
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_auth_user_created() FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- 7. FONCTION INTERNE DE CRÉATION / RAFRAÎCHISSEMENT DES VUES DE COMPATIBILITÉ
--    (Active uniquement si tot.enable_compat_views = 'on', c.-à-d. base ancienne migrée)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tot_refresh_compat_views()
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_pair RECORD;
  v_new_exists BOOLEAN;
  v_old_is_table BOOLEAN;
BEGIN
  IF COALESCE(current_setting('tot.enable_compat_views', true), '') <> 'on' THEN
    RETURN;
  END IF;

  FOR v_pair IN
    SELECT * FROM (
      VALUES
        ('users', 'core_users'),
        ('roles', 'core_roles'),
        ('departments', 'core_departments'),
        ('projects', 'core_projects'),
        ('company_settings', 'core_company_settings'),
        ('app_settings', 'core_app_settings'),
        ('license_config', 'core_license_config'),
        ('app_compat', 'core_app_compat'),
        ('audit_logs', 'core_audit_logs'),
        ('login_logs', 'core_login_logs'),
        ('processed_operations', 'core_processed_operations'),
        ('files', 'core_files'),
        ('products', 'stk_products'),
        ('categories', 'stk_categories'),
        ('sub_categories', 'stk_sub_categories'),
        ('stock_levels', 'stk_stock_levels'),
        ('depots', 'stk_depots'),
        ('stock_movements', 'stk_movements'),
        ('movements', 'stk_movements'),
        ('material_orders', 'stk_material_orders'),
        ('material_order_items', 'stk_material_order_items'),
        ('print_jobs', 'stk_print_jobs'),
        ('print_stations', 'stk_print_stations'),
        ('inventory_audits', 'stk_inventory_audits'),
        ('inventory_audit_items', 'stk_inventory_audit_items'),
        ('order_preparations_log', 'stk_order_preparations_log')
    ) AS t(old_name, new_name)
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_pair.new_name AND c.relkind = 'r'
    ) INTO v_new_exists;

    SELECT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_pair.old_name AND c.relkind = 'r'
    ) INTO v_old_is_table;

    IF v_new_exists AND NOT v_old_is_table THEN
      EXECUTE format('DROP VIEW IF EXISTS public.%I', v_pair.old_name);
      EXECUTE format(
        'CREATE OR REPLACE VIEW public.%I WITH (security_invoker = true) AS SELECT * FROM public.%I',
        v_pair.old_name,
        v_pair.new_name
      );
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', v_pair.old_name);
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated, service_role',
        v_pair.old_name
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public._tot_refresh_compat_views() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN PERFORM public._tot_refresh_compat_views(); END $$;
