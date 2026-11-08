-- =========================================================================
-- TOT STOCK - SCRIPT 15 : RECHERCHE SERVEUR COMMANDES & MOUVEMENTS (15_search_orders_movements.sql)
-- Schéma 2.5.0 (App 5.10.0)
-- Description :
--   1. Crée les index de recherche sur public.stk_material_orders et public.stk_movements.
--   2. Crée la RPC paginée public.search_material_orders(...) retournant (total_count bigint, row_data jsonb).
--   3. Crée la RPC paginée public.search_stock_movements(...) retournant (total_count bigint, row_data jsonb),
--      en respectant strictement public.can_view_movement(...) et les dépôts autorisés.
-- Dépendances : 00..14 (notamment 03_rpc_stock_and_orders.sql et 04_mouvements_et_depots_vehicules.sql)
-- Ordre d'exécution : 15 (après 14_mailing.sql, avant 07_app_compat.sql)
-- Idempotent / Rejouable : oui
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. VÉRIFICATION DES PRÉREQUIS
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stk_material_orders'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (15_search_orders_movements.sql) : La table public.stk_material_orders est absente.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stk_movements'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (15_search_orders_movements.sql) : La table public.stk_movements est absente.';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 1. INDEX COMPLÉMENTAIRES POUR LA RECHERCHE ET LA FENÊTRE 7 JOURS
-- -------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_stk_material_orders_created_status
  ON public.stk_material_orders (created_at DESC, status);

CREATE INDEX IF NOT EXISTS idx_stk_material_orders_depot_created
  ON public.stk_material_orders (depot_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stk_material_orders_dept_created
  ON public.stk_material_orders (requester_department, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stk_movements_created_type
  ON public.stk_movements (created_at DESC, movement_type);

CREATE INDEX IF NOT EXISTS idx_stk_movements_dept_created
  ON public.stk_movements (department_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stk_movements_user_created
  ON public.stk_movements (user_id, created_at DESC);

-- -------------------------------------------------------------------------
-- 2. RPC : public.search_material_orders
-- Recherche multi-critères paginée sur toute la table stk_material_orders
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_material_orders(
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, INTEGER, INTEGER
);

CREATE OR REPLACE FUNCTION public.search_material_orders(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_status TEXT[] DEFAULT NULL,
  p_preparer TEXT DEFAULT NULL,
  p_requester TEXT DEFAULT NULL,
  p_department TEXT DEFAULT NULL,
  p_site TEXT DEFAULT NULL,
  p_depot TEXT DEFAULT NULL,
  p_reference TEXT DEFAULT NULL,
  p_min_cost NUMERIC DEFAULT NULL,
  p_max_cost NUMERIC DEFAULT NULL,
  p_text TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  total_count BIGINT,
  row_data JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_role INT;
  v_allowed_depots TEXT[];
  v_is_blocked BOOLEAN;
  v_is_service BOOLEAN := false;
  v_safe_limit INT;
  v_safe_offset INT;
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_setting('role', true) = 'service_role'
     OR (
       COALESCE(NULLIF(trim(current_setting('request.jwt.claims', true)), ''), '') LIKE '{%'
       AND COALESCE((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') = 'service_role'
     ) THEN
    v_is_service := true;
    v_caller_role := 0;
  ELSE
    SELECT id::text, role_id, allowed_depots, is_blocked
    INTO v_caller_id, v_caller_role, v_allowed_depots, v_is_blocked
    FROM public.core_users
    WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
    LIMIT 1;

    IF v_caller_id IS NULL OR v_is_blocked = TRUE THEN
      RAISE EXCEPTION 'Utilisateur non authentifié ou compte bloqué' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_safe_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 1000);
  v_safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  RETURN QUERY
  WITH filtered AS (
    SELECT o.*
    FROM public.stk_material_orders o
    WHERE COALESCE(o.notes, '') <> '[SUPPRIMÉE]'
      -- Périmètre dépôts de l'utilisateur (sauf rôles 0/1/service ou perm_mov_view_all / perm_orders_manage)
      AND (
        v_is_service
        OR v_caller_role IN (0, 1)
        OR public.current_user_has_perm('perm_mov_view_all')
        OR public.current_user_has_perm('perm_orders_manage')
        OR v_allowed_depots IS NULL
        OR array_length(v_allowed_depots, 1) IS NULL
        OR array_length(v_allowed_depots, 1) = 0
        OR '*' = ANY(v_allowed_depots)
        OR 'ALL' = ANY(v_allowed_depots)
        OR o.depot_name IS NULL
        OR o.depot_name = ANY(v_allowed_depots)
        OR o.requester_id = v_caller_id
      )
      AND (p_from IS NULL OR o.created_at >= p_from)
      AND (p_to IS NULL OR o.created_at <= p_to)
      AND (
        p_status IS NULL
        OR array_length(p_status, 1) IS NULL
        OR array_length(p_status, 1) = 0
        OR o.status = ANY(p_status)
      )
      AND (
        p_preparer IS NULL
        OR TRIM(p_preparer) = ''
        OR UPPER(TRIM(p_preparer)) = 'ALL'
        OR COALESCE(o.preparer_id, '') = TRIM(p_preparer)
        OR COALESCE(o.preparer_name, '') ILIKE '%' || TRIM(p_preparer) || '%'
      )
      AND (
        p_requester IS NULL
        OR TRIM(p_requester) = ''
        OR UPPER(TRIM(p_requester)) = 'ALL'
        OR COALESCE(o.requester_id, '') = TRIM(p_requester)
        OR COALESCE(o.requester_name, '') ILIKE '%' || TRIM(p_requester) || '%'
      )
      AND (
        p_department IS NULL
        OR TRIM(p_department) = ''
        OR UPPER(TRIM(p_department)) = 'ALL'
        OR COALESCE(o.requester_department, '') ILIKE TRIM(p_department)
      )
      AND (
        p_site IS NULL
        OR TRIM(p_site) = ''
        OR UPPER(TRIM(p_site)) = 'ALL'
        OR COALESCE(o.site_number, '') ILIKE '%' || TRIM(p_site) || '%'
        OR COALESCE(o.site_name, '') ILIKE '%' || TRIM(p_site) || '%'
      )
      AND (
        p_depot IS NULL
        OR TRIM(p_depot) = ''
        OR UPPER(TRIM(p_depot)) = 'ALL'
        OR COALESCE(o.depot_name, '') ILIKE TRIM(p_depot)
      )
      AND (
        p_reference IS NULL
        OR TRIM(p_reference) = ''
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(o.items, '[]'::jsonb)) elem
          WHERE COALESCE(elem->>'product_ref', '') ILIKE '%' || TRIM(p_reference) || '%'
             OR COALESCE(elem->>'product_name', '') ILIKE '%' || TRIM(p_reference) || '%'
             OR COALESCE(elem->>'substituted_with_ref', '') ILIKE '%' || TRIM(p_reference) || '%'
        )
      )
      AND (p_min_cost IS NULL OR COALESCE(o.total_cost, 0) >= p_min_cost)
      AND (p_max_cost IS NULL OR COALESCE(o.total_cost, 0) <= p_max_cost)
      AND (
        p_text IS NULL
        OR TRIM(p_text) = ''
        OR COALESCE(o.order_number, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(o.notes, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(o.requester_name, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(o.preparer_name, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(o.site_number, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(o.site_name, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(o.depot_name, '') ILIKE '%' || TRIM(p_text) || '%'
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(o.items, '[]'::jsonb)) elem
          WHERE COALESCE(elem->>'product_ref', '') ILIKE '%' || TRIM(p_text) || '%'
             OR COALESCE(elem->>'product_name', '') ILIKE '%' || TRIM(p_text) || '%'
        )
      )
  )
  SELECT
    COUNT(*) OVER()::BIGINT AS total_count,
    to_jsonb(f) AS row_data
  FROM filtered f
  ORDER BY f.created_at DESC, f.id DESC
  LIMIT v_safe_limit
  OFFSET v_safe_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.search_material_orders(
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.search_material_orders(
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, INTEGER, INTEGER
) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 3. RPC : public.search_stock_movements
-- Recherche multi-critères paginée sur toute la table stk_movements
-- Respecte strictement public.can_view_movement(...)
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_stock_movements(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INTEGER, INTEGER
);

CREATE OR REPLACE FUNCTION public.search_stock_movements(
  p_type TEXT DEFAULT NULL,
  p_user TEXT DEFAULT NULL,
  p_department TEXT DEFAULT NULL,
  p_site TEXT DEFAULT NULL,
  p_depot TEXT DEFAULT NULL,
  p_reference TEXT DEFAULT NULL,
  p_order_number TEXT DEFAULT NULL,
  p_min_cost NUMERIC DEFAULT NULL,
  p_max_cost NUMERIC DEFAULT NULL,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_text TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  total_count BIGINT,
  row_data JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_role INT;
  v_is_blocked BOOLEAN;
  v_is_service BOOLEAN := false;
  v_norm_type TEXT;
  v_safe_limit INT;
  v_safe_offset INT;
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_setting('role', true) = 'service_role'
     OR (
       COALESCE(NULLIF(trim(current_setting('request.jwt.claims', true)), ''), '') LIKE '{%'
       AND COALESCE((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') = 'service_role'
     ) THEN
    v_is_service := true;
    v_caller_role := 0;
  ELSE
    SELECT id::text, role_id, is_blocked
    INTO v_caller_id, v_caller_role, v_is_blocked
    FROM public.core_users
    WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
    LIMIT 1;

    IF v_caller_id IS NULL OR v_is_blocked = TRUE THEN
      RAISE EXCEPTION 'Utilisateur non authentifié ou compte bloqué' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_norm_type := UPPER(TRIM(COALESCE(p_type, '')));
  IF v_norm_type = '' OR v_norm_type = 'ALL' THEN
    v_norm_type := NULL;
  END IF;

  v_safe_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 1000);
  v_safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  RETURN QUERY
  WITH filtered AS (
    SELECT
      m.*,
      COALESCE(m.total_cost, ROUND(COALESCE(m.quantity_changed, 0) * COALESCE(p.unit_price, 0), 2), 0) AS computed_cost
    FROM public.stk_movements m
    LEFT JOIN public.stk_products p ON p.id::text = m.product_id::text
    WHERE (
        v_is_service
        OR public.can_view_movement(
          m.user_id::text,
          m.department_name::text,
          COALESCE(m.depot_name, p.store_name)::text,
          m.site_number::text
        )
      )
      AND (
        v_norm_type IS NULL
        OR (
          v_norm_type = 'TRANSFER'
          AND (
            (m.dest_depot_name IS NOT NULL AND TRIM(m.dest_depot_name) <> '')
            OR COALESCE(m.reason, '') ILIKE '[TRANSFERT%'
          )
        )
        OR (v_norm_type = 'IN' AND m.movement_type = 'IN')
        OR (v_norm_type = 'OUT' AND m.movement_type = 'OUT')
      )
      AND (
        p_user IS NULL
        OR TRIM(p_user) = ''
        OR UPPER(TRIM(p_user)) = 'ALL'
        OR COALESCE(m.user_id::text, '') = TRIM(p_user)
        OR COALESCE(m.user_name, '') ILIKE '%' || TRIM(p_user) || '%'
      )
      AND (
        p_department IS NULL
        OR TRIM(p_department) = ''
        OR UPPER(TRIM(p_department)) = 'ALL'
        OR COALESCE(m.department_name, '') ILIKE TRIM(p_department)
      )
      AND (
        p_site IS NULL
        OR TRIM(p_site) = ''
        OR UPPER(TRIM(p_site)) = 'ALL'
        OR COALESCE(m.site_number, '') ILIKE '%' || TRIM(p_site) || '%'
      )
      AND (
        p_depot IS NULL
        OR TRIM(p_depot) = ''
        OR UPPER(TRIM(p_depot)) = 'ALL'
        OR COALESCE(m.depot_name, p.store_name, '') ILIKE TRIM(p_depot)
        OR COALESCE(m.dest_depot_name, '') ILIKE TRIM(p_depot)
      )
      AND (
        p_reference IS NULL
        OR TRIM(p_reference) = ''
        OR COALESCE(m.product_ref, p.reference, '') ILIKE '%' || TRIM(p_reference) || '%'
        OR COALESCE(p.brand || ' ' || p.model, '') ILIKE '%' || TRIM(p_reference) || '%'
      )
      AND (
        p_order_number IS NULL
        OR TRIM(p_order_number) = ''
        OR COALESCE(m.order_number, '') ILIKE '%' || TRIM(p_order_number) || '%'
      )
      AND (
        p_min_cost IS NULL
        OR COALESCE(m.total_cost, ROUND(COALESCE(m.quantity_changed, 0) * COALESCE(p.unit_price, 0), 2), 0) >= p_min_cost
      )
      AND (
        p_max_cost IS NULL
        OR COALESCE(m.total_cost, ROUND(COALESCE(m.quantity_changed, 0) * COALESCE(p.unit_price, 0), 2), 0) <= p_max_cost
      )
      AND (p_from IS NULL OR m.created_at >= p_from)
      AND (p_to IS NULL OR m.created_at <= p_to)
      AND (
        p_text IS NULL
        OR TRIM(p_text) = ''
        OR COALESCE(m.product_ref, p.reference, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(p.brand, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(p.model, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(m.user_name, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(m.department_name, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(m.site_number, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(m.order_number, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(m.reason, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(m.depot_name, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(m.dest_depot_name, '') ILIKE '%' || TRIM(p_text) || '%'
      )
  )
  SELECT
    COUNT(*) OVER()::BIGINT AS total_count,
    (to_jsonb(f) - 'computed_cost') || jsonb_build_object('total_cost', f.computed_cost) AS row_data
  FROM filtered f
  ORDER BY f.created_at DESC, f.id DESC
  LIMIT v_safe_limit
  OFFSET v_safe_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.search_stock_movements(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.search_stock_movements(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INTEGER, INTEGER
) TO authenticated, service_role;
