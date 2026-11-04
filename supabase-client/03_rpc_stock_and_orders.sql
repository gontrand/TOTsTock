-- =========================================================================
-- TOT STOCK - SCRIPT 03 : RPC STOCK & COMMANDES (03_rpc_stock_and_orders.sql)
-- Exécution transactionnelle côté serveur, idempotence (operation_id),
-- contrôle d'intégrité, quotas de références (max_references) et concurrence
-- S'appuie strictement sur les fonctions de sécurité définies dans 02_rls_hardening.sql
-- Rejouable : oui
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. VÉRIFICATION DES PRÉREQUIS (Point 3)
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'products'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (03_rpc_stock_and_orders.sql) : La table public.products est absente. Exécutez d''abord 02_rls_hardening.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'license_config'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (03_rpc_stock_and_orders.sql) : La table public.license_config est absente. Exécutez d''abord 02_rls_hardening.sql.';
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
-- 0.1 ALIGNEMENT SCHÉMA ADDITIF (TABLES CLIENTS RÉELLES)
-- -------------------------------------------------------------------------
-- Conversion idempotente de stock_movements.id (et movements, audit_logs, stock_levels)
-- lorsque la colonne id est numérique / IDENTITY sur une ancienne base, en conservant les lignes.
DO $$
DECLARE v_type text; v_identity text;
BEGIN
  SELECT data_type, is_identity INTO v_type, v_identity
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='stock_movements' AND column_name='id';
  IF v_type IS NOT NULL AND v_type <> 'text' THEN
    BEGIN
      CREATE TABLE IF NOT EXISTS public.stock_movements_backup_ids AS TABLE public.stock_movements;
      ALTER TABLE public.stock_movements_backup_ids ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON TABLE public.stock_movements_backup_ids FROM PUBLIC, anon, authenticated;
      IF v_identity = 'YES' THEN
        ALTER TABLE public.stock_movements ALTER COLUMN id DROP IDENTITY;
      END IF;
      ALTER TABLE public.stock_movements ALTER COLUMN id DROP DEFAULT;
      ALTER TABLE public.stock_movements ALTER COLUMN id TYPE text USING id::text;
    EXCEPTION WHEN OTHERS THEN
      DECLARE
        v_err_msg text;
        v_err_detail text;
      BEGIN
        GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT, v_err_detail = PG_EXCEPTION_DETAIL;
        RAISE EXCEPTION 'conversion impossible : %', COALESCE(NULLIF(v_err_detail, ''), v_err_msg);
      END;
    END;
  END IF;
END $$;

DO $$
DECLARE
  v_tbl text;
  v_type text;
  v_identity text;
  v_dep_obj text;
  v_err_msg text;
  v_err_detail text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['stock_movements', 'movements', 'audit_logs', 'stock_levels'] LOOP
    SELECT data_type, is_identity INTO v_type, v_identity
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = v_tbl AND column_name = 'id';

    IF v_type IS NOT NULL AND v_type <> 'text' THEN
      -- Vérification préalable de clés étrangères dépendantes de <table_name>.id
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
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT, v_err_detail = PG_EXCEPTION_DETAIL;
        RAISE EXCEPTION 'conversion impossible : %', COALESCE(NULLIF(v_err_detail, ''), v_err_msg);
      END;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.license_config
  ADD COLUMN IF NOT EXISTS modules TEXT[] DEFAULT ARRAY['stock']::TEXT[];

-- Identifiants générés par la base pour les lignes écrites par les fonctions RPC (rejouable)
ALTER TABLE IF EXISTS public.movements ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE IF EXISTS public.stock_movements ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE IF EXISTS public.audit_logs ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE IF EXISTS public.stock_levels ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE IF EXISTS public.stock_levels ADD COLUMN IF NOT EXISTS rack_location TEXT DEFAULT NULL;

-- 0.2 Colonnes complémentaires sur movements & stock_movements si manquantes
ALTER TABLE IF EXISTS public.stock_movements ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE IF EXISTS public.movements ADD COLUMN IF NOT EXISTS reason TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'movements') THEN
    ALTER TABLE public.movements
      ADD COLUMN IF NOT EXISTS product_ref TEXT,
      ADD COLUMN IF NOT EXISTS site_number TEXT,
      ADD COLUMN IF NOT EXISTS department_name TEXT,
      ADD COLUMN IF NOT EXISTS depot_name TEXT DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS dest_depot_name TEXT DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS order_number TEXT;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stock_movements') THEN
    ALTER TABLE public.stock_movements
      ADD COLUMN IF NOT EXISTS product_ref TEXT,
      ADD COLUMN IF NOT EXISTS site_number TEXT,
      ADD COLUMN IF NOT EXISTS department_name TEXT,
      ADD COLUMN IF NOT EXISTS depot_name TEXT DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS dest_depot_name TEXT DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS order_number TEXT;
  END IF;
END $$;

-- 0.3 Colonnes sur material_orders
ALTER TABLE public.material_orders
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
-- 1. TABLE DES OPÉRATIONS TRAITÉES (IDEMPOTENCE SERVEUR)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.processed_operations (
  operation_id UUID PRIMARY KEY,
  user_id TEXT,
  entity TEXT NOT NULL,
  action TEXT NOT NULL,
  result JSONB,
  processed_at TIMESTAMPTZ DEFAULT now()
);

-- Alignement avec la version V4 de process_stock_movement (colonnes action_type et created_at ;
-- les anciennes colonnes entity / action deviennent facultatives). Rejouable.
ALTER TABLE public.processed_operations
  ADD COLUMN IF NOT EXISTS action_type TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.processed_operations ALTER COLUMN entity DROP NOT NULL;
ALTER TABLE public.processed_operations ALTER COLUMN action DROP NOT NULL;

ALTER TABLE public.processed_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.processed_operations FROM anon, public;
GRANT SELECT ON TABLE public.processed_operations TO authenticated;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'processed_operations'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.processed_operations', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "User read self processed_operations"
  ON public.processed_operations FOR SELECT TO authenticated
  USING (user_id = public.current_user_id());

-- -------------------------------------------------------------------------
-- 2. TRIGGER QUOTA DE RÉFÉRENCES (max_references) & RÈGLE DE DOWNGRADE
-- Seul l'INSERT de nouvelles références est bloqué au-delà du quota.
-- La consultation et la mise à jour des articles existants restent permises.
-- Aucun downgrade ne supprime jamais de données existantes.
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
    FROM public.license_config
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_plan_type := 'free';
    v_signed_token := NULL;
  END;

  -- Les quotas appliqués sont strictement ceux de la licence signée (signed_token).
  -- Toute licence non gratuite dépourvue de jeton signé retombe sur le forfait 'free'.
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

  -- Quota illimité (99999)
  IF v_max_references >= 99999 THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_current_count FROM public.products;

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

DROP TRIGGER IF EXISTS trg_enforce_license_max_references ON public.products;
CREATE TRIGGER trg_enforce_license_max_references
  BEFORE INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_license_max_references_quota();

-- -------------------------------------------------------------------------
-- 3. RPC TRANSACTIONNELLE DE MOUVEMENT DE STOCK (process_stock_movement)
-- Atomicité complète : vérification profil, permissions, droits dépôt,
-- verrouillage FOR UPDATE, mise à jour stock par dépôt (stock_levels) et global (products),
-- gestion des transferts inter-dépôts (TRANSFER) et inventaires (INVENTORY),
-- insertion mouvement et audit.
-- AUCUN repli administrateur (erreur 42501 si non authentifié ou bloqué).
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
  -- 1. Authentification & vérification stricte du profil (ZÉRO repli administrateur)
  SELECT id::text, role_id, name, trigram, allowed_depots, is_blocked
  INTO v_caller_id, v_caller_role, v_caller_name, v_caller_trigram, v_allowed_depots, v_is_blocked
  FROM public.users
  WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
  LIMIT 1;

  IF v_caller_id IS NULL OR v_is_blocked = TRUE THEN
    RAISE EXCEPTION 'User profile not found or blocked' USING ERRCODE = '42501';
  END IF;

  -- Définir la variable de session transactionnelle pour autoriser la mise à jour de products.quantity par le trigger
  PERFORM set_config('app.stock_rpc', 'on', true);

  -- 2. Idempotence : si cette opération a déjà été exécutée
  SELECT * INTO v_existing_op FROM public.processed_operations WHERE operation_id = p_operation_id LIMIT 1;
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
      OR public.current_user_has_perm('perm_mov_out')
      OR public.current_user_has_perm('perm_stock_in')
      OR public.current_user_has_perm('perm_prod_movement_direct')
    ) THEN
      RAISE EXCEPTION 'Permission denied: stock transfer rights required (perm_mov_out or perm_stock_in)' USING ERRCODE = '42501';
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
  FROM public.products
  WHERE id::text = p_product_id::text
  FOR UPDATE;

  IF v_product_ref IS NULL THEN
    RAISE EXCEPTION 'Article introuvable (ID: %).', p_product_id USING ERRCODE = 'P0002';
  END IF;

  IF p_quantity IS NULL OR (v_mov_type != 'INVENTORY' AND p_quantity <= 0) OR (v_mov_type = 'INVENTORY' AND p_quantity < 0) THEN
    RAISE EXCEPTION 'La quantité du mouvement est invalide.' USING ERRCODE = '22023';
  END IF;

  -- 6. Gestion du stock par dépôt (stock_levels si la table existe, sinon repli sur products)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stock_levels') THEN
    IF NOT EXISTS (SELECT 1 FROM public.stock_levels WHERE product_id = p_product_id) THEN
      INSERT INTO public.stock_levels (product_id, depot_name, quantity, updated_at)
      VALUES (p_product_id, v_prod_store_name, v_prod_initial_qty, now())
      ON CONFLICT (product_id, depot_name) DO NOTHING;
    END IF;

    INSERT INTO public.stock_levels (product_id, depot_name, quantity, updated_at)
    VALUES (p_product_id, v_source_depot, 0, now())
    ON CONFLICT (product_id, depot_name) DO NOTHING;

    SELECT quantity
    INTO v_current_depot_stock
    FROM public.stock_levels
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

    UPDATE public.stock_levels
    SET quantity = v_new_depot_stock,
        updated_at = now()
    WHERE product_id = p_product_id AND depot_name = v_source_depot;

    IF v_mov_type = 'TRANSFER' AND v_dest_depot IS NOT NULL THEN
      INSERT INTO public.stock_levels (product_id, depot_name, quantity, rack_location, updated_at)
      VALUES (p_product_id, v_dest_depot, 0, p_dest_rack, now())
      ON CONFLICT (product_id, depot_name) DO NOTHING;

      SELECT quantity
      INTO v_dest_depot_stock
      FROM public.stock_levels
      WHERE product_id = p_product_id AND depot_name = v_dest_depot
      FOR UPDATE;

      v_new_dest_stock := v_dest_depot_stock + p_quantity;

      UPDATE public.stock_levels
      SET quantity = v_new_dest_stock,
          rack_location = COALESCE(p_dest_rack, rack_location),
          updated_at = now()
      WHERE product_id = p_product_id AND depot_name = v_dest_depot;
    END IF;

    SELECT COALESCE(SUM(quantity), 0)
    INTO v_total_product_stock
    FROM public.stock_levels
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

  -- 7. Mise à jour atomique de products
  UPDATE public.products
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

  -- 8. Calcul de la variation enregistrée pour l'historique (mouvements & audit)
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

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'movements') THEN
    INSERT INTO public.movements (
      id, product_id, product_ref, user_id, user_name, movement_type,
      quantity_changed, site_number, department_name, depot_name, dest_depot_name, total_cost, order_number, created_at
    ) VALUES (
      v_mov_id, p_product_id, COALESCE((p_metadata->>'product_ref'), v_product_ref),
      v_caller_id, v_caller_name,
      v_effective_dir,
      v_recorded_qty, COALESCE(p_project_name, p_reason), p_department,
      v_source_depot, v_dest_depot,
      v_total_cost, (p_metadata->>'order_number'), now()
    );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stock_movements') THEN
    INSERT INTO public.stock_movements (
      product_id, product_ref, user_id, user_name, movement_type,
      quantity_changed, reason, site_number, department_name, depot_name, dest_depot_name, total_cost, order_number, created_at
    ) VALUES (
      p_product_id, COALESCE((p_metadata->>'product_ref'), v_product_ref),
      v_caller_id, v_caller_name,
      v_effective_dir,
      ROUND(v_recorded_qty)::integer, COALESCE(p_reason, 'Mouvement direct'),
      p_project_name, p_department,
      v_source_depot, v_dest_depot,
      v_total_cost, (p_metadata->>'order_number'), now()
    );
  END IF;

  -- 9. Insertion dans audit_logs
  INSERT INTO public.audit_logs (
    id, type, category, user_id, user_name, user_trigram,
    product_id, product_ref, quantity_changed, site_number, depot_name,
    title, description, badge_text, meta, created_at
  ) VALUES (
    'AUD-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || p_operation_id::text,
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

  INSERT INTO public.processed_operations (operation_id, user_id, entity, action, action_type, result, created_at)
  VALUES (p_operation_id, v_caller_id, 'product_stock', v_mov_type, 'STOCK_MOVE_V4', v_result, now())
  ON CONFLICT (operation_id) DO NOTHING;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.process_stock_movement(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_stock_movement(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;

-- -------------------------------------------------------------------------
-- 4. RPC DE TRANSITION DU STATUT DE COMMANDE (transition_order_status)
-- Validation sécurisée côté serveur de l'ensemble du cycle de vie d'une commande
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.transition_order_status(UUID, TEXT, TEXT, TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.transition_order_status(
  p_operation_id UUID,
  p_order_id TEXT,
  p_target_status TEXT, -- 'PENDING', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED', 'REJECTED'
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
  -- 1. Authentification stricte (ZÉRO repli administrateur)
  SELECT id::text, role_id, name, trigram, is_blocked
  INTO v_caller_id, v_caller_role, v_caller_name, v_caller_trigram, v_is_blocked
  FROM public.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_caller_id IS NULL OR v_is_blocked = TRUE THEN
    RAISE EXCEPTION 'User profile not found or blocked' USING ERRCODE = '42501';
  END IF;

  -- 2. Idempotence
  SELECT * INTO v_existing_op FROM public.processed_operations WHERE operation_id = p_operation_id LIMIT 1;
  IF v_existing_op.operation_id IS NOT NULL THEN
    IF v_existing_op.user_id IS DISTINCT FROM v_caller_id THEN
      RAISE EXCEPTION 'Operation ID already registered by another user' USING ERRCODE = '42501';
    END IF;
    RETURN v_existing_op.result;
  END IF;

  -- 3. Verrouillage de la commande
  SELECT * INTO v_order
  FROM public.material_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Commande introuvable (ID: %).', p_order_id USING ERRCODE = 'P0002';
  END IF;

  v_status := UPPER(TRIM(p_target_status));

  -- 4. Machine à états finis des commandes
  -- WAITING_APPROVAL -> PENDING / REJECTED (Validation par approbateur département ou chantier)
  IF v_status IN ('PENDING', 'REJECTED') AND v_order.status = 'WAITING_APPROVAL' THEN
    IF v_order.requester_id = v_caller_id AND NOT (
      public.is_super_admin()
      OR v_caller_role IN (0, 1, 2, 8)
      OR public.current_user_has_perm('perm_order_approve')
      OR public.current_user_has_perm('perm_orders_manage')
      OR public.current_user_is_dept_or_proj_manager_for_order(v_order.requester_department, v_order.site_number)
    ) THEN
      RAISE EXCEPTION 'Interdiction d''auto-approbation : Vous ne pouvez pas valider votre propre commande.' USING ERRCODE = '42501';
    END IF;
    IF NOT (
      public.is_super_admin()
      OR v_caller_role IN (0, 1, 2, 8)
      OR (public.is_administrator() AND (v_order.requester_department IS NULL OR EXISTS (SELECT 1 FROM public.users u WHERE u.auth_user_id = auth.uid() AND (u.department IS NULL OR LOWER(TRIM(u.department)) = LOWER(TRIM(v_order.requester_department))))))
      OR public.current_user_has_perm('perm_order_approve')
      OR public.current_user_has_perm('perm_orders_manage')
      OR public.current_user_has_perm('perm_menu_order_prep')
      OR public.current_user_is_dept_or_proj_manager_for_order(v_order.requester_department, v_order.site_number)
    ) THEN
      RAISE EXCEPTION 'Droits insuffisants pour approuver les commandes de ce département.' USING ERRCODE = '42501';
    END IF;

  -- PENDING -> PREPARING (Prise en charge par préparateur)
  ELSIF v_status = 'PREPARING' THEN
    IF v_order.status != 'PENDING' THEN
      RAISE EXCEPTION 'Transition invalide : La commande doit être en attente (PENDING) pour démarrer la préparation.' USING ERRCODE = '22023';
    END IF;
    IF NOT (
      public.is_super_admin()
      OR public.current_user_has_perm('perm_menu_order_prep')
      OR EXISTS (SELECT 1 FROM public.users u WHERE u.auth_user_id = auth.uid() AND u.is_preparer = true)
    ) THEN
      RAISE EXCEPTION 'Permission refusée : Seuls les préparateurs peuvent prendre en charge une commande.' USING ERRCODE = '42501';
    END IF;

  -- PREPARING -> READY (Prête pour retrait)
  ELSIF v_status = 'READY' THEN
    IF v_order.status != 'PREPARING' THEN
      RAISE EXCEPTION 'Transition invalide : La commande doit être en cours de préparation (PREPARING) pour être marquée prête.' USING ERRCODE = '22023';
    END IF;
    IF NOT (
      public.is_super_admin()
      OR public.current_user_has_perm('perm_menu_order_prep')
      OR EXISTS (SELECT 1 FROM public.users u WHERE u.auth_user_id = auth.uid() AND u.is_preparer = true)
    ) THEN
      RAISE EXCEPTION 'Permission refusée : Seuls les préparateurs peuvent marquer une commande prête.' USING ERRCODE = '42501';
    END IF;

  -- READY -> COLLECTED (Retrait par demandeur, délégué ou magasinier)
  ELSIF v_status = 'COLLECTED' THEN
    IF v_order.status != 'READY' THEN
      RAISE EXCEPTION 'Transition invalide : La commande doit être prête (READY) pour être retirée.' USING ERRCODE = '22023';
    END IF;
    IF NOT (
      v_order.requester_id = v_caller_id
      OR (v_order.pickup_delegate_id IS NOT NULL AND v_order.pickup_delegate_id = v_caller_id)
      OR public.is_super_admin()
      OR public.current_user_has_perm('perm_menu_order_prep')
      OR EXISTS (SELECT 1 FROM public.users u WHERE u.auth_user_id = auth.uid() AND u.is_preparer = true)
    ) THEN
      RAISE EXCEPTION 'Permission refusée : Seul le demandeur, le délégué de retrait ou un magasinier peut confirmer le retrait.' USING ERRCODE = '42501';
    END IF;

  -- CANCELLED (Annulation : demandeur tant que non préparée, ou approbateur / gestionnaire)
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
        OR (public.is_administrator() AND (v_order.requester_department IS NULL OR EXISTS (SELECT 1 FROM public.users u WHERE u.auth_user_id = auth.uid() AND (u.department IS NULL OR LOWER(TRIM(u.department)) = LOWER(TRIM(v_order.requester_department))))))
        OR public.current_user_has_perm('perm_menu_order_prep')
        OR EXISTS (SELECT 1 FROM public.users u WHERE u.auth_user_id = auth.uid() AND u.is_preparer = true)
      ) THEN
        RAISE EXCEPTION 'Droits insuffisants pour annuler cette commande.' USING ERRCODE = '42501';
      END IF;
    END IF;

  ELSE
    RAISE EXCEPTION 'Transition invalide de % vers %.', v_order.status, v_status USING ERRCODE = '22023';
  END IF;

  -- 5. Mise à jour de la commande avec colonnes réelles
  UPDATE public.material_orders
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

  -- 6. Audit dans audit_logs (colonnes réelles)
  INSERT INTO public.audit_logs (
    id, type, category, user_id, user_name, user_trigram,
    depot_name, title, description, badge_text, meta, created_at
  ) VALUES (
    'AUD-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || substr(p_operation_id::text, 1, 6),
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

  INSERT INTO public.processed_operations (operation_id, user_id, entity, action, result)
  VALUES (p_operation_id, v_caller_id, 'order_transition', 'ACCEPTED', v_result);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_order_status(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_order_status(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- -------------------------------------------------------------------------
-- 5. UNICITÉ STRICTE DES NUMÉROS DE COMMANDE ATTRIBUÉS PAR LE SERVEUR
-- Format en ligne : XXXXXXXX-CMD-YYMMDD-XX
-- Format hors-ligne : XXXXXXXX-CMD-YYMMDD-XX_OFF
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_material_orders_order_number_unique
  ON public.material_orders (UPPER(TRIM(order_number)));

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

  -- Verrou transactionnel consultatif par date pour sérialiser les attributions simultanées
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
  FROM public.material_orders
  WHERE UPPER(TRIM(order_number)) LIKE '%-CMD-' || v_date || '-%';

  v_next_seq := v_max_seq + 1;

  LOOP
    v_candidate := v_site || '-CMD-' || v_date || '-' || LPAD(v_next_seq::TEXT, 2, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.material_orders
      WHERE UPPER(TRIM(order_number)) IN (v_candidate, v_candidate || '_OFF')
    );
    v_next_seq := v_next_seq + 1;
  END LOOP;

  RETURN v_candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_unique_order_number(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_unique_order_number(TEXT, TEXT) TO authenticated;

