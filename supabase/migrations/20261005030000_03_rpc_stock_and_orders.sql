-- =========================================================================
-- FICHIER GÉNÉRÉ AUTOMATIQUEMENT PAR scripts/build-sql.mjs — NE PAS MODIFIER DIRECTEMENT
-- Source de vérité : supabase-client/03_rpc_stock_and_orders.sql
-- Étape 03 : RPC transactionnelles stock, commandes et quota max_references
-- =========================================================================
-- =========================================================================
-- TOT STOCK - SCRIPT 03 : RPC STOCK & COMMANDES (03_rpc_stock_and_orders.sql)
-- Description : Exécution transactionnelle côté serveur, idempotence (operation_id),
--   contrôle d'intégrité, quotas de références (max_references) et concurrence
--   sur les tables préfixées core_* et stk_*.
-- Dépendances : 02_rls_hardening.sql
-- Rejouable : oui (idempotent)
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. VÉRIFICATION DES PRÉREQUIS (Point 3)
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stk_products'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (03_rpc_stock_and_orders.sql) : La table public.stk_products est absente. Exécutez d''abord 02_rls_hardening.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'core_license_config'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (03_rpc_stock_and_orders.sql) : La table public.core_license_config est absente. Exécutez d''abord 02_rls_hardening.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'current_user_id'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (03_rpc_stock_and_orders.sql) : La fonction public.current_user_id() est absente. Exécutez d''abord 02_rls_hardening.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'plan_limits'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (03_rpc_stock_and_orders.sql) : La fonction public.plan_limits(TEXT) est absente. Exécutez d''abord 02_rls_hardening.sql.';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 0.05 PURGE DES DÉCLENCHEURS HÉRITÉS SUR LES TABLES DE STOCK (v41 & v42)
-- -------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_process_stock_movement ON public.stk_movements;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'stock_movements' AND c.relkind = 'r'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_process_stock_movement ON public.stock_movements';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.process_stock_movement();

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
  FOR r IN
    SELECT t.tgname, c.relname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN (
        'stk_movements', 'stk_stock_levels', 'stk_products',
        'stock_movements', 'stock_levels', 'movements', 'products'
      )
      AND NOT t.tgisinternal
      AND NOT (t.tgname = ANY(v_allowed_triggers))
  LOOP
    RAISE NOTICE 'Suppression du déclencheur hérité : % sur public.%', r.tgname, r.relname;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', r.tgname, r.relname);
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 0.1 ALIGNEMENT SCHÉMA ADDITIF (TABLES CLIENTS RÉELLES)
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_tbl text;
  v_type text;
  v_identity text;
  v_dep_obj text;
  v_err_msg text;
  v_err_detail text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'stk_movements', 'core_audit_logs', 'stk_stock_levels',
    'stock_movements', 'movements', 'audit_logs', 'stock_levels'
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
          DROP VIEW IF EXISTS public.stock_movements;
          DROP VIEW IF EXISTS public.movements;
          DROP VIEW IF EXISTS public.audit_logs;
          DROP VIEW IF EXISTS public.stock_levels;
          EXECUTE format('CREATE TABLE IF NOT EXISTS public.%I AS TABLE public.%I', v_tbl || '_backup_ids', v_tbl);
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl || '_backup_ids');
          EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_tbl || '_backup_ids');
          IF v_identity = 'YES' THEN
            EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id DROP IDENTITY', v_tbl);
          END IF;
          EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id DROP DEFAULT', v_tbl);
          EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id TYPE text USING id::text', v_tbl);
          IF EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = '_tot_refresh_compat_views'
          ) THEN
            PERFORM public._tot_refresh_compat_views();
          END IF;
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT, v_err_detail = PG_EXCEPTION_DETAIL;
          RAISE EXCEPTION 'conversion impossible : %', COALESCE(NULLIF(v_err_detail, ''), v_err_msg);
        END;
      END IF;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.core_license_config
  ADD COLUMN IF NOT EXISTS modules TEXT[] DEFAULT ARRAY['stock']::TEXT[];

-- Identifiants générés par la base pour les lignes écrites par les fonctions RPC (rejouable)
ALTER TABLE IF EXISTS public.stk_movements ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE IF EXISTS public.core_audit_logs ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE IF EXISTS public.stk_stock_levels ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE IF EXISTS public.stk_stock_levels ADD COLUMN IF NOT EXISTS rack_location TEXT DEFAULT NULL;

-- 0.2 Colonnes complémentaires sur stk_movements si manquantes
ALTER TABLE IF EXISTS public.stk_movements ADD COLUMN IF NOT EXISTS reason TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stk_movements') THEN
    ALTER TABLE public.stk_movements
      ADD COLUMN IF NOT EXISTS product_ref TEXT,
      ADD COLUMN IF NOT EXISTS site_number TEXT,
      ADD COLUMN IF NOT EXISTS department_name TEXT,
      ADD COLUMN IF NOT EXISTS depot_name TEXT DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS dest_depot_name TEXT DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS order_number TEXT;
  END IF;
END $$;

-- 0.3 Colonnes sur stk_material_orders
ALTER TABLE public.stk_material_orders
  ADD COLUMN IF NOT EXISTS preparer_id TEXT,
  ADD COLUMN IF NOT EXISTS preparer_name TEXT,
  ADD COLUMN IF NOT EXISTS pickup_delegate_id TEXT,
  ADD COLUMN IF NOT EXISTS requester_department TEXT,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- -------------------------------------------------------------------------
-- 1. TABLE DES OPÉRATIONS TRAITÉES (IDEMPOTENCE SERVEUR : core_processed_operations)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.core_processed_operations (
  operation_id UUID PRIMARY KEY,
  app TEXT DEFAULT 'stock',
  user_id TEXT,
  entity TEXT,
  action TEXT,
  action_type TEXT,
  result JSONB,
  processed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.core_processed_operations
  ADD COLUMN IF NOT EXISTS app TEXT DEFAULT 'stock',
  ADD COLUMN IF NOT EXISTS action_type TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.core_processed_operations ALTER COLUMN entity DROP NOT NULL;
ALTER TABLE public.core_processed_operations ALTER COLUMN action DROP NOT NULL;

ALTER TABLE public.core_processed_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.core_processed_operations FROM anon, public;
GRANT SELECT ON TABLE public.core_processed_operations TO authenticated;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'core_processed_operations'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.core_processed_operations', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "User read self processed_operations"
  ON public.core_processed_operations FOR SELECT TO authenticated
  USING (user_id = public.current_user_id());

-- Rafraîchissement des vues de compatibilité si présentes (bases migrées)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_tot_refresh_compat_views'
  ) THEN
    PERFORM public._tot_refresh_compat_views();
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 2. TRIGGER QUOTA DE RÉFÉRENCES (max_references) & RÈGLE DE DOWNGRADE
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.enforce_license_max_references_quota() CASCADE;
CREATE OR REPLACE FUNCTION public.enforce_license_max_references_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_references INT := 50;
  v_plan_type TEXT := 'free';
  v_signed_token TEXT := NULL;
  v_token_json JSONB := NULL;
  v_sig TEXT := NULL;
  v_limits JSONB;
  v_current_count INT;
BEGIN
  BEGIN
    SELECT LOWER(COALESCE(plan_type, 'free')), signed_token
    INTO v_plan_type, v_signed_token
    FROM public.core_license_config
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_plan_type := 'free';
    v_signed_token := NULL;
  END;

  IF v_signed_token IS NOT NULL AND TRIM(v_signed_token) <> '' THEN
    BEGIN
      IF LEFT(TRIM(v_signed_token), 1) = '{' THEN
        v_token_json := TRIM(v_signed_token)::jsonb;
        v_sig := COALESCE(v_token_json->>'signature', '');
      ELSIF POSITION('.' IN TRIM(v_signed_token)) > 1 THEN
        v_token_json := convert_from(decode(split_part(TRIM(v_signed_token), '.', 1), 'base64'), 'UTF8')::jsonb;
        v_sig := split_part(TRIM(v_signed_token), '.', 2);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_token_json := NULL;
      v_sig := NULL;
    END;
  END IF;

  IF v_token_json IS NOT NULL AND LENGTH(TRIM(COALESCE(v_sig, ''))) >= 8 THEN
    v_plan_type := LOWER(COALESCE(v_token_json->>'plan', v_token_json->>'plan_type', 'free'));
  ELSE
    v_plan_type := 'free';
  END IF;

  v_limits := public.plan_limits(v_plan_type);
  v_plan_type := COALESCE(v_limits->>'plan', 'free');
  v_max_references := COALESCE((v_limits->>'max_references')::int, (v_limits->>'max_products')::int, 50);

  IF v_max_references IS NULL OR v_max_references <= 0 THEN
    v_max_references := 50;
  END IF;

  IF v_max_references >= 99999 THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_current_count FROM public.stk_products;

  IF v_current_count >= v_max_references THEN
    RAISE EXCEPTION 'Quota de références atteint (Forfait % : max % références, actuelles : %). Veuillez passer au forfait supérieur pour créer des articles supplémentaires.',
      UPPER(v_plan_type), v_max_references, v_current_count
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_license_max_references_quota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_license_max_references_quota() TO authenticated;

DROP TRIGGER IF EXISTS trg_enforce_license_max_references ON public.stk_products;
CREATE TRIGGER trg_enforce_license_max_references
  BEFORE INSERT ON public.stk_products
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_license_max_references_quota();

-- -------------------------------------------------------------------------
-- 3. RPC TRANSACTIONNELLE DE MOUVEMENT DE STOCK (process_stock_movement)
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.process_stock_movement(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.process_stock_movement(
  p_operation_id UUID,
  p_product_id TEXT,
  p_depot_name TEXT,
  p_type TEXT, -- 'IN', 'OUT', 'TRANSFER', 'INVENTORY', 'RETURN', 'LOSS'
  p_quantity NUMERIC,
  p_reason TEXT DEFAULT NULL,
  p_project_name TEXT DEFAULT NULL,
  p_department TEXT DEFAULT NULL,
  p_dest_depot_name TEXT DEFAULT NULL,
  p_dest_rack TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_action TEXT DEFAULT 'STOCK_DIRECT_MOVE'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_role INT;
  v_caller_name TEXT;
  v_caller_trigram TEXT;
  v_allowed_depots TEXT[];
  v_is_blocked BOOLEAN;
  v_existing_op RECORD;

  v_source_depot TEXT;
  v_dest_depot TEXT;
  v_prod_store_name TEXT;
  v_prod_initial_qty NUMERIC;
  v_current_depot_stock NUMERIC;
  v_new_depot_stock NUMERIC;
  v_dest_depot_stock NUMERIC;
  v_new_dest_stock NUMERIC;
  v_total_product_stock NUMERIC;
  v_recorded_qty NUMERIC;
  v_effective_dir TEXT;

  v_mov_type TEXT;
  v_mov_id TEXT;
  v_result JSONB;
  v_product_ref TEXT;
  v_unit_price NUMERIC;
  v_total_cost NUMERIC;
BEGIN
  -- 0. Sonde de diagnostic (sans effet de bord) pour vérifier la présence de la signature à 12 paramètres
  IF p_action = 'DIAGNOSTIC_PING' OR p_product_id = '__DIAGNOSTIC_PING__' THEN
    RETURN jsonb_build_object('success', true, 'ready', true, 'params', 12);
  END IF;

  -- 1. Authentification & vérification stricte du profil (ZÉRO repli administrateur)
  SELECT id::text, role_id, name, trigram, allowed_depots, is_blocked
  INTO v_caller_id, v_caller_role, v_caller_name, v_caller_trigram, v_allowed_depots, v_is_blocked
  FROM public.core_users
  WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
  LIMIT 1;

  IF v_caller_id IS NULL OR v_is_blocked = TRUE THEN
    RAISE EXCEPTION 'User profile not found or blocked' USING ERRCODE = '42501';
  END IF;

  -- Définir la variable de session transactionnelle pour autoriser la mise à jour de stk_products.quantity par le trigger
  PERFORM set_config('app.stock_rpc', 'on', true);

  -- 2. Idempotence : si cette opération a déjà été exécutée
  SELECT * INTO v_existing_op FROM public.core_processed_operations WHERE operation_id = p_operation_id LIMIT 1;
  IF v_existing_op.operation_id IS NOT NULL THEN
    IF v_existing_op.user_id IS DISTINCT FROM v_caller_id THEN
      RAISE EXCEPTION 'Operation ID already registered by another user' USING ERRCODE = '42501';
    END IF;
    RETURN v_existing_op.result;
  END IF;

  -- 3. Vérification des permissions métier selon le type de mouvement
  v_mov_type := UPPER(TRIM(p_type));
  IF v_mov_type IN ('OUT', 'LOSS') THEN
    IF NOT (
      public.is_super_admin()
      OR v_caller_role IN (0, 1)
      OR public.current_user_has_perm('perm_mov_out')
      OR public.current_user_has_perm('perm_prod_movement_direct')
    ) THEN
      RAISE EXCEPTION 'Permission denied: stock outflow rights required (perm_mov_out)' USING ERRCODE = '42501';
    END IF;
  ELSIF v_mov_type IN ('IN', 'RETURN') THEN
    IF NOT (
      public.is_super_admin()
      OR v_caller_role IN (0, 1)
      OR public.current_user_has_perm('perm_stock_in')
      OR public.current_user_has_perm('perm_prod_movement_direct')
    ) THEN
      RAISE EXCEPTION 'Permission denied: stock inflow rights required (perm_stock_in)' USING ERRCODE = '42501';
    END IF;
  ELSIF v_mov_type = 'TRANSFER' THEN
    IF NOT (
      public.is_super_admin()
      OR v_caller_role IN (0, 1)
      OR public.current_user_has_perm('perm_stock_transfer')
      OR public.current_user_has_perm('perm_mov_out')
      OR public.current_user_has_perm('perm_stock_in')
      OR public.current_user_has_perm('perm_prod_movement_direct')
    ) THEN
      RAISE EXCEPTION 'Permission denied: stock transfer rights required (perm_stock_transfer, perm_mov_out or perm_stock_in)' USING ERRCODE = '42501';
    END IF;
  ELSIF v_mov_type = 'INVENTORY' THEN
    IF NOT (
      public.is_super_admin()
      OR v_caller_role IN (0, 1)
      OR public.current_user_has_perm('perm_menu_inventory_audit')
      OR public.current_user_has_perm('perm_inventory_validate')
    ) THEN
      RAISE EXCEPTION 'Permission denied: inventory audit rights required (perm_menu_inventory_audit or perm_inventory_validate)' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown movement type: %', p_type USING ERRCODE = '22023';
  END IF;

  -- 4. Normalisation et validation des dépôts source et destination
  v_source_depot := COALESCE(NULLIF(TRIM(p_depot_name), ''), 'Dépôt Principal');
  v_dest_depot := NULLIF(TRIM(p_dest_depot_name), '');

  IF v_mov_type = 'TRANSFER' THEN
    IF v_dest_depot IS NULL THEN
      RAISE EXCEPTION 'Un transfert inter-dépôts requiert un dépôt de destination (p_dest_depot_name).' USING ERRCODE = '22023';
    END IF;
    IF LOWER(v_dest_depot) = LOWER(v_source_depot) THEN
      RAISE EXCEPTION 'Le dépôt de destination ("%") doit être distinct du dépôt source ("%").', v_dest_depot, v_source_depot USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NOT (public.is_super_admin() OR v_caller_role IN (0, 1)) THEN
    IF v_allowed_depots IS NOT NULL AND array_length(v_allowed_depots, 1) > 0 THEN
      IF NOT ('*' = ANY(v_allowed_depots) OR 'ALL' = ANY(v_allowed_depots) OR v_source_depot = ANY(v_allowed_depots)) THEN
        RAISE EXCEPTION 'Accès refusé au dépôt source "%". Vos droits ne couvrent pas ce magasin.', v_source_depot USING ERRCODE = '42501';
      END IF;
      IF v_mov_type = 'TRANSFER' AND v_dest_depot IS NOT NULL THEN
        IF NOT ('*' = ANY(v_allowed_depots) OR 'ALL' = ANY(v_allowed_depots) OR v_dest_depot = ANY(v_allowed_depots)) THEN
          RAISE EXCEPTION 'Accès refusé au dépôt destination "%". Vos droits ne couvrent pas ce magasin.', v_dest_depot USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;
  END IF;

  -- 5. Verrouillage FOR UPDATE de l'article source
  SELECT reference, unit_price, COALESCE(quantity, 0), COALESCE(NULLIF(TRIM(store_name), ''), 'Dépôt Principal')
  INTO v_product_ref, v_unit_price, v_prod_initial_qty, v_prod_store_name
  FROM public.stk_products
  WHERE id::text = p_product_id::text
  FOR UPDATE;

  IF v_product_ref IS NULL THEN
    RAISE EXCEPTION 'Article introuvable (ID: %).', p_product_id USING ERRCODE = 'P0002';
  END IF;

  IF p_quantity IS NULL OR (v_mov_type != 'INVENTORY' AND p_quantity <= 0) OR (v_mov_type = 'INVENTORY' AND p_quantity < 0) THEN
    RAISE EXCEPTION 'La quantité du mouvement est invalide.' USING ERRCODE = '22023';
  END IF;

  -- 6. Gestion du stock par dépôt (stk_stock_levels)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stk_stock_levels') THEN
    IF NOT EXISTS (SELECT 1 FROM public.stk_stock_levels WHERE product_id = p_product_id) THEN
      INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, updated_at)
      VALUES (p_product_id, v_prod_store_name, v_prod_initial_qty, now())
      ON CONFLICT (product_id, depot_name) DO NOTHING;
    END IF;

    INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, rack_location, updated_at)
    VALUES (
      p_product_id,
      v_source_depot,
      0,
      CASE WHEN v_mov_type != 'TRANSFER' THEN NULLIF(TRIM(COALESCE(p_dest_rack, p_metadata->>'rack_location')), '') ELSE NULL END,
      now()
    )
    ON CONFLICT (product_id, depot_name) DO NOTHING;

    SELECT quantity
    INTO v_current_depot_stock
    FROM public.stk_stock_levels
    WHERE product_id = p_product_id AND depot_name = v_source_depot
    FOR UPDATE;

    IF v_mov_type IN ('OUT', 'TRANSFER', 'LOSS') THEN
      IF v_current_depot_stock < p_quantity THEN
        RAISE EXCEPTION 'Stock insuffisant dans le dépôt "%" pour "%" (Disponible: %, Demandé: %).',
          v_source_depot, COALESCE(v_product_ref, p_product_id), v_current_depot_stock, p_quantity
          USING ERRCODE = '23514';
      END IF;
      v_new_depot_stock := v_current_depot_stock - p_quantity;
    ELSIF v_mov_type IN ('IN', 'RETURN') THEN
      v_new_depot_stock := v_current_depot_stock + p_quantity;
    ELSIF v_mov_type = 'INVENTORY' THEN
      v_new_depot_stock := p_quantity;
    END IF;

    UPDATE public.stk_stock_levels
    SET quantity = v_new_depot_stock,
        rack_location = CASE
          WHEN v_mov_type != 'TRANSFER' AND NULLIF(TRIM(COALESCE(p_dest_rack, p_metadata->>'rack_location')), '') IS NOT NULL
          THEN NULLIF(TRIM(COALESCE(p_dest_rack, p_metadata->>'rack_location')), '')
          ELSE rack_location
        END,
        min_alert = CASE
          WHEN p_metadata ? 'min_alert' AND (p_metadata->>'min_alert') ~ '^[0-9]+(\.[0-9]+)?$'
          THEN (p_metadata->>'min_alert')::numeric
          ELSE min_alert
        END,
        updated_at = now()
    WHERE product_id = p_product_id AND depot_name = v_source_depot;

    IF v_mov_type = 'TRANSFER' AND v_dest_depot IS NOT NULL THEN
      INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, rack_location, updated_at)
      VALUES (p_product_id, v_dest_depot, 0, p_dest_rack, now())
      ON CONFLICT (product_id, depot_name) DO NOTHING;

      SELECT quantity
      INTO v_dest_depot_stock
      FROM public.stk_stock_levels
      WHERE product_id = p_product_id AND depot_name = v_dest_depot
      FOR UPDATE;

      v_new_dest_stock := v_dest_depot_stock + p_quantity;

      UPDATE public.stk_stock_levels
      SET quantity = v_new_dest_stock,
          rack_location = COALESCE(p_dest_rack, rack_location),
          updated_at = now()
      WHERE product_id = p_product_id AND depot_name = v_dest_depot;
    END IF;

    SELECT COALESCE(SUM(quantity), 0)
    INTO v_total_product_stock
    FROM public.stk_stock_levels
    WHERE product_id = p_product_id;
  ELSE
    v_current_depot_stock := v_prod_initial_qty;
    IF v_mov_type IN ('OUT', 'TRANSFER', 'LOSS') THEN
      IF v_current_depot_stock < p_quantity THEN
        RAISE EXCEPTION 'Stock insuffisant pour "%" (Disponible: %, Demandé: %).',
          COALESCE(v_product_ref, p_product_id), v_current_depot_stock, p_quantity
          USING ERRCODE = '23514';
      END IF;
      v_new_depot_stock := v_current_depot_stock - p_quantity;
    ELSIF v_mov_type IN ('IN', 'RETURN') THEN
      v_new_depot_stock := v_current_depot_stock + p_quantity;
    ELSIF v_mov_type = 'INVENTORY' THEN
      v_new_depot_stock := p_quantity;
    END IF;
    v_total_product_stock := CASE WHEN v_mov_type = 'TRANSFER' THEN v_current_depot_stock ELSE v_new_depot_stock END;
  END IF;

  -- 7. Mise à jour atomique de stk_products
  UPDATE public.stk_products
  SET quantity = v_total_product_stock,
      store_name = CASE
        WHEN v_mov_type = 'TRANSFER' AND v_dest_depot IS NOT NULL AND v_new_depot_stock = 0 THEN v_dest_depot
        ELSE store_name
      END,
      shelf_name = CASE
        WHEN v_mov_type = 'TRANSFER' AND p_dest_rack IS NOT NULL AND v_new_depot_stock = 0 THEN p_dest_rack
        ELSE shelf_name
      END,
      updated_at = now()
  WHERE id::text = p_product_id::text;

  -- 8. Calcul de la variation enregistrée pour l'historique (stk_movements & core_audit_logs)
  IF v_mov_type = 'INVENTORY' THEN
    v_recorded_qty := ABS(v_new_depot_stock - v_current_depot_stock);
    v_effective_dir := CASE WHEN v_new_depot_stock >= v_current_depot_stock THEN 'IN' ELSE 'OUT' END;
  ELSIF v_mov_type IN ('OUT', 'TRANSFER', 'LOSS') THEN
    v_recorded_qty := p_quantity;
    v_effective_dir := 'OUT';
  ELSE
    v_recorded_qty := p_quantity;
    v_effective_dir := 'IN';
  END IF;

  v_mov_id := 'MOV-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || p_operation_id::text;
  v_total_cost := ROUND(v_recorded_qty * COALESCE(v_unit_price, 0), 2);

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stk_movements') THEN
    INSERT INTO public.stk_movements (
      id, product_id, product_ref, user_id, user_name, movement_type,
      quantity_changed, reason, site_number, department_name, depot_name, dest_depot_name, total_cost, order_number, created_at
    ) VALUES (
      v_mov_id, p_product_id, COALESCE((p_metadata->>'product_ref'), v_product_ref),
      v_caller_id, v_caller_name,
      v_effective_dir,
      v_recorded_qty, COALESCE(p_reason, 'Mouvement direct'),
      COALESCE(p_project_name, p_reason), p_department,
      v_source_depot, v_dest_depot,
      v_total_cost, (p_metadata->>'order_number'), now()
    );
  END IF;

  -- 9. Insertion dans core_audit_logs
  INSERT INTO public.core_audit_logs (
    id, app, type, category, user_id, user_name, user_trigram,
    product_id, product_ref, quantity_changed, site_number, depot_name,
    title, description, badge_text, meta, created_at
  ) VALUES (
    'AUD-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || p_operation_id::text,
    'stock',
    'STOCK_' || v_mov_type,
    'MOVEMENTS',
    v_caller_id,
    v_caller_name,
    v_caller_trigram,
    p_product_id,
    COALESCE(v_product_ref, (p_metadata->>'product_ref')),
    v_recorded_qty,
    p_project_name,
    v_source_depot,
    format('Mouvement %s (%s)', v_mov_type, v_recorded_qty),
    format('Stock "%s" (%s) modifié de %s à %s par %s (%s)', COALESCE(v_product_ref, p_product_id), v_source_depot, v_current_depot_stock, v_new_depot_stock, v_caller_name, COALESCE(p_reason, 'Opération directe')),
    format('%s %s', CASE WHEN v_effective_dir = 'OUT' THEN '-' ELSE '+' END, v_recorded_qty),
    jsonb_build_object(
      'operation_id', p_operation_id,
      'movement_type', v_mov_type,
      'old_stock', v_current_depot_stock,
      'new_stock', v_new_depot_stock,
      'dest_new_stock', v_new_dest_stock,
      'total_product_stock', v_total_product_stock,
      'reason', p_reason,
      'dest_depot', v_dest_depot,
      'dest_rack', p_dest_rack
    ),
    now()
  );

  -- 10. Enregistrement du résultat pour idempotence stricte
  v_result := jsonb_build_object(
    'success', true,
    'operation_id', p_operation_id,
    'movement_id', v_mov_id,
    'product_id', p_product_id,
    'depot_name', v_source_depot,
    'dest_depot_name', v_dest_depot,
    'old_quantity', v_current_depot_stock,
    'depot_quantity', v_new_depot_stock,
    'dest_depot_quantity', v_new_dest_stock,
    'new_quantity', v_total_product_stock,
    'quantity_changed', v_recorded_qty,
    'type', v_mov_type,
    'movement_type', v_mov_type,
    'total_cost', v_total_cost,
    'timestamp', now()
  );

  INSERT INTO public.core_processed_operations (operation_id, app, user_id, entity, action, action_type, result, created_at)
  VALUES (p_operation_id, 'stock', v_caller_id, 'product_stock', v_mov_type, 'STOCK_MOVE_V4', v_result, now())
  ON CONFLICT (operation_id) DO NOTHING;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.process_stock_movement(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_stock_movement(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;

-- -------------------------------------------------------------------------
-- 4. RPC DE TRANSITION DU STATUT DE COMMANDE (transition_order_status)
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.transition_order_status(UUID, TEXT, TEXT, TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.transition_order_status(
  p_operation_id UUID,
  p_order_id TEXT,
  p_target_status TEXT,
  p_preparer_id TEXT DEFAULT NULL,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_role INT;
  v_caller_name TEXT;
  v_caller_trigram TEXT;
  v_is_blocked BOOLEAN;
  v_existing_op RECORD;
  v_order RECORD;
  v_result JSONB;
  v_status TEXT;
BEGIN
  SELECT id::text, role_id, name, trigram, is_blocked
  INTO v_caller_id, v_caller_role, v_caller_name, v_caller_trigram, v_is_blocked
  FROM public.core_users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_caller_id IS NULL OR v_is_blocked = TRUE THEN
    RAISE EXCEPTION 'User profile not found or blocked' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing_op FROM public.core_processed_operations WHERE operation_id = p_operation_id LIMIT 1;
  IF v_existing_op.operation_id IS NOT NULL THEN
    IF v_existing_op.user_id IS DISTINCT FROM v_caller_id THEN
      RAISE EXCEPTION 'Operation ID already registered by another user' USING ERRCODE = '42501';
    END IF;
    RETURN v_existing_op.result;
  END IF;

  SELECT * INTO v_order
  FROM public.stk_material_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Commande introuvable (ID: %).', p_order_id USING ERRCODE = 'P0002';
  END IF;

  v_status := UPPER(TRIM(p_target_status));

  IF v_status IN ('PENDING', 'REJECTED') AND v_order.status = 'WAITING_APPROVAL' THEN
    IF v_order.requester_id = v_caller_id AND NOT (
      public.is_super_admin()
      OR v_caller_role = 0
      OR public.current_user_has_perm('perm_order_approve')
      OR public.current_user_has_perm('perm_orders_manage')
      OR public.current_user_is_dept_or_proj_manager_for_order(v_order.requester_department, v_order.site_number)
    ) THEN
      RAISE EXCEPTION 'Interdiction d''auto-approbation : Vous ne pouvez pas valider votre propre commande.' USING ERRCODE = '42501';
    END IF;
    IF NOT (
      public.is_super_admin()
      OR v_caller_role = 0
      OR (public.is_administrator() AND (v_order.requester_department IS NULL OR EXISTS (SELECT 1 FROM public.core_users u WHERE u.auth_user_id = auth.uid() AND (u.department IS NULL OR LOWER(TRIM(u.department)) = LOWER(TRIM(v_order.requester_department))))))
      OR public.current_user_has_perm('perm_order_approve')
      OR public.current_user_has_perm('perm_orders_manage')
      OR public.current_user_has_perm('perm_menu_order_prep')
      OR public.current_user_is_dept_or_proj_manager_for_order(v_order.requester_department, v_order.site_number)
    ) THEN
      RAISE EXCEPTION 'Droits insuffisants pour approuver les commandes de ce département.' USING ERRCODE = '42501';
    END IF;

  ELSIF v_status = 'PREPARING' THEN
    IF v_order.status != 'PENDING' THEN
      RAISE EXCEPTION 'Transition invalide : La commande doit être en attente (PENDING) pour démarrer la préparation.' USING ERRCODE = '22023';
    END IF;
    IF NOT (
      public.is_super_admin()
      OR public.current_user_has_perm('perm_menu_order_prep')
      OR EXISTS (SELECT 1 FROM public.core_users u WHERE u.auth_user_id = auth.uid() AND u.is_preparer = true)
    ) THEN
      RAISE EXCEPTION 'Permission refusée : Seuls les préparateurs peuvent prendre en charge une commande.' USING ERRCODE = '42501';
    END IF;

  ELSIF v_status = 'READY' THEN
    IF v_order.status != 'PREPARING' THEN
      RAISE EXCEPTION 'Transition invalide : La commande doit être en cours de préparation (PREPARING) pour être marquée prête.' USING ERRCODE = '22023';
    END IF;
    IF NOT (
      public.is_super_admin()
      OR public.current_user_has_perm('perm_menu_order_prep')
      OR EXISTS (SELECT 1 FROM public.core_users u WHERE u.auth_user_id = auth.uid() AND u.is_preparer = true)
    ) THEN
      RAISE EXCEPTION 'Permission refusée : Seuls les préparateurs peuvent marquer une commande prête.' USING ERRCODE = '42501';
    END IF;

  ELSIF v_status = 'COLLECTED' THEN
    IF v_order.status != 'READY' THEN
      RAISE EXCEPTION 'Transition invalide : La commande doit être prête (READY) pour être retirée.' USING ERRCODE = '22023';
    END IF;
    IF NOT (
      v_order.requester_id = v_caller_id
      OR (v_order.pickup_delegate_id IS NOT NULL AND v_order.pickup_delegate_id = v_caller_id)
      OR public.is_super_admin()
      OR public.current_user_has_perm('perm_menu_order_prep')
      OR EXISTS (SELECT 1 FROM public.core_users u WHERE u.auth_user_id = auth.uid() AND u.is_preparer = true)
    ) THEN
      RAISE EXCEPTION 'Permission refusée : Seul le demandeur, le délégué de retrait ou un magasinier peut confirmer le retrait.' USING ERRCODE = '42501';
    END IF;

  ELSIF v_status = 'CANCELLED' THEN
    IF v_order.status IN ('COLLECTED', 'CANCELLED', 'REJECTED') THEN
      RAISE EXCEPTION 'Impossible d''annuler une commande au statut %.', v_order.status USING ERRCODE = '22023';
    END IF;
    IF v_order.requester_id = v_caller_id THEN
      IF v_order.status NOT IN ('WAITING_APPROVAL', 'PENDING') AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Le demandeur ne peut annuler sa commande qu''avant le début de la préparation.' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NOT (
        public.is_super_admin()
        OR (public.is_administrator() AND (v_order.requester_department IS NULL OR EXISTS (SELECT 1 FROM public.core_users u WHERE u.auth_user_id = auth.uid() AND (u.department IS NULL OR LOWER(TRIM(u.department)) = LOWER(TRIM(v_order.requester_department))))))
        OR public.current_user_has_perm('perm_menu_order_prep')
        OR EXISTS (SELECT 1 FROM public.core_users u WHERE u.auth_user_id = auth.uid() AND u.is_preparer = true)
      ) THEN
        RAISE EXCEPTION 'Droits insuffisants pour annuler cette commande.' USING ERRCODE = '42501';
      END IF;
    END IF;

  ELSE
    RAISE EXCEPTION 'Transition invalide de % vers %.', v_order.status, v_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.stk_material_orders
  SET status = v_status,
      preparer_id = CASE
        WHEN v_status = 'PREPARING' THEN COALESCE(p_preparer_id, v_caller_id)
        ELSE preparer_id
      END,
      preparer_name = CASE
        WHEN v_status = 'PREPARING' THEN v_caller_name
        ELSE preparer_name
      END,
      approved_by = CASE WHEN v_status = 'PENDING' AND v_order.status = 'WAITING_APPROVAL' THEN v_caller_name ELSE approved_by END,
      approved_at = CASE WHEN v_status = 'PENDING' AND v_order.status = 'WAITING_APPROVAL' THEN now() ELSE approved_at END,
      rejected_by = CASE WHEN v_status = 'REJECTED' THEN v_caller_name ELSE rejected_by END,
      rejected_at = CASE WHEN v_status = 'REJECTED' THEN now() ELSE rejected_at END,
      rejection_reason = CASE WHEN v_status = 'REJECTED' THEN COALESCE(p_comment, rejection_reason) ELSE rejection_reason END,
      ready_at = CASE WHEN v_status = 'READY' THEN now() ELSE ready_at END,
      collected_at = CASE WHEN v_status = 'COLLECTED' THEN now() ELSE collected_at END,
      collected_by = CASE WHEN v_status = 'COLLECTED' THEN v_caller_name ELSE collected_by END,
      updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.core_audit_logs (
    id, app, type, category, user_id, user_name, user_trigram,
    depot_name, title, description, badge_text, meta, created_at
  ) VALUES (
    'AUD-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || substr(p_operation_id::text, 1, 6),
    'stock',
    'ORDER_STATUS_CHANGE',
    'ORDERS',
    v_caller_id,
    v_caller_name,
    v_caller_trigram,
    v_order.depot_name,
    'Statut commande mis à jour',
    format('Commande %s : transition %s -> %s', COALESCE(v_order.order_number, p_order_id), v_order.status, v_status),
    v_status,
    jsonb_build_object(
      'operation_id', p_operation_id,
      'order_id', p_order_id,
      'old_status', v_order.status,
      'new_status', v_status,
      'comment', p_comment
    ),
    now()
  );

  v_result := jsonb_build_object(
    'success', true,
    'operation_id', p_operation_id,
    'order_id', p_order_id,
    'old_status', v_order.status,
    'new_status', v_status
  );

  INSERT INTO public.core_processed_operations (operation_id, app, user_id, entity, action, result)
  VALUES (p_operation_id, 'stock', v_caller_id, 'order_transition', 'ACCEPTED', v_result);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_order_status(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_order_status(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- -------------------------------------------------------------------------
-- 5. UNICITÉ STRICTE DES NUMÉROS DE COMMANDE ATTRIBUÉS PAR LE SERVEUR
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_material_orders_order_number_unique
  ON public.stk_material_orders (UPPER(TRIM(order_number)));

DROP FUNCTION IF EXISTS public.allocate_unique_order_number(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.allocate_unique_order_number(
  p_site_number TEXT,
  p_date_prefix TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site TEXT;
  v_date TEXT;
  v_max_seq INT := 0;
  v_next_seq INT;
  v_candidate TEXT;
BEGIN
  v_site := COALESCE(NULLIF(UPPER(TRIM(p_site_number)), ''), 'CH-00');
  v_date := COALESCE(NULLIF(TRIM(p_date_prefix), ''), to_char(now(), 'YYMMDD'));

  PERFORM pg_advisory_xact_lock(hashtext('tot_order_num_' || v_date));

  SELECT COALESCE(
    MAX(
      NULLIF(
        regexp_replace(UPPER(TRIM(order_number)), '^.*-CMD-' || v_date || '-([0-9]+)(_OFF)?$', '\1'),
        UPPER(TRIM(order_number))
      )::INT
    ),
    0
  )
  INTO v_max_seq
  FROM public.stk_material_orders
  WHERE UPPER(TRIM(order_number)) LIKE '%-CMD-' || v_date || '-%';

  v_next_seq := v_max_seq + 1;

  LOOP
    v_candidate := v_site || '-CMD-' || v_date || '-' || LPAD(v_next_seq::TEXT, 2, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.stk_material_orders
      WHERE UPPER(TRIM(order_number)) IN (v_candidate, v_candidate || '_OFF')
    );
    v_next_seq := v_next_seq + 1;
  END LOOP;

  RETURN v_candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_unique_order_number(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_unique_order_number(TEXT, TEXT) TO authenticated;
