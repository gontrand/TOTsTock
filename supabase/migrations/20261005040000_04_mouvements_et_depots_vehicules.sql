-- =========================================================================
-- FICHIER GÉNÉRÉ AUTOMATIQUEMENT PAR scripts/build-sql.mjs — NE PAS MODIFIER DIRECTEMENT
-- Source de vérité : supabase-client/04_mouvements_et_depots_vehicules.sql
-- Étape 04 : Mouvements, dépôts multi-types (FIXED/VEHICLE/CONTAINER) et stock_levels
-- =========================================================================
-- =========================================================================
-- TOT STOCK - SCRIPT 04 : MOUVEMENTS ET DÉPÔTS VÉHICULES / CONTENEURS (04_mouvements_et_depots_vehicules.sql)
-- Description : Multi-dépôts physiques (FIXED, VEHICLE, CONTAINER), conteneurs de chantiers rattachés,
--   RLS granulaire can_view_movement, visibilité stricte stk_stock_levels, quota max_depots actif.
-- Dépendances : 02_rls_hardening.sql, 03_rpc_stock_and_orders.sql
-- Rejouable : oui (idempotent)
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. VÉRIFICATION DES PRÉREQUIS (Point 3)
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stk_depots'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (04_mouvements_et_depots_vehicules.sql) : La table public.stk_depots est absente. Exécutez d''abord 02_rls_hardening.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stk_stock_levels'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (04_mouvements_et_depots_vehicules.sql) : La table public.stk_stock_levels est absente. Exécutez d''abord 02_rls_hardening.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'plan_limits'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (04_mouvements_et_depots_vehicules.sql) : La fonction public.plan_limits(TEXT) est absente. Exécutez d''abord 02_rls_hardening.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'process_stock_movement'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (04_mouvements_et_depots_vehicules.sql) : La fonction public.process_stock_movement est absente. Exécutez d''abord 03_rpc_stock_and_orders.sql.';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 1. SCHÉMA & ÉVOLUTION DE LA TABLE : public.stk_depots (FIXED, VEHICLE, CONTAINER)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stk_depots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id TEXT,
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  address TEXT,
  manager TEXT,
  phone TEXT,
  email TEXT,
  description TEXT,
  type TEXT DEFAULT 'FIXED', -- 'FIXED', 'VEHICLE' ou 'CONTAINER'
  vehicle_type TEXT DEFAULT NULL, -- 'FOURGON', 'CAMIONNETTE', 'UTILITAIRE', 'POIDS_LOURD', etc.
  license_plate TEXT DEFAULT NULL,
  container_ref TEXT DEFAULT NULL, -- Numéro / identifiant unique du conteneur de chantier
  project_number TEXT DEFAULT NULL, -- Chantier rattaché (core_projects.project_number)
  manager_id TEXT DEFAULT NULL,
  manager_name TEXT DEFAULT NULL,
  binome_ids JSONB DEFAULT '[]'::jsonb,
  binome_names JSONB DEFAULT '[]'::jsonb,
  department_id TEXT DEFAULT NULL,
  department_name TEXT DEFAULT NULL,
  pickup_zones JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.stk_depots
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'FIXED', -- 'FIXED', 'VEHICLE' ou 'CONTAINER'
  ADD COLUMN IF NOT EXISTS vehicle_type TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS license_plate TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS container_ref TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS project_number TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS manager_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS manager_name TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS binome_ids JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS binome_names JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS department_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS department_name TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pickup_zones JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_depots_name ON public.stk_depots(name);
CREATE INDEX IF NOT EXISTS idx_depots_type ON public.stk_depots(type);
CREATE INDEX IF NOT EXISTS idx_depots_project_number ON public.stk_depots(project_number);
CREATE INDEX IF NOT EXISTS idx_depots_manager ON public.stk_depots(manager_id);
CREATE INDEX IF NOT EXISTS idx_depots_license_plate ON public.stk_depots(license_plate);

-- Trigger de quota licence max_depots : un conteneur ou dépôt fermé (is_active = false) ne compte pas dans le quota
DROP FUNCTION IF EXISTS public.enforce_license_max_depots_quota() CASCADE;
CREATE OR REPLACE FUNCTION public.enforce_license_max_depots_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count INT;
  v_max_depots INT := 1;
  v_token_max_depots INT := NULL;
  v_plan_type TEXT := 'free';
  v_signed_token TEXT := NULL;
  v_token_json JSONB := NULL;
  v_sig TEXT := NULL;
  v_limits JSONB;
  v_plan_max_depots INT := 1;
BEGIN
  -- Si le dépôt inséré/modifié est inactif, il ne consomme pas de place dans le quota
  IF NEW.is_active = false THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT max_depots, LOWER(COALESCE(plan_type, 'free')), signed_token
    INTO v_max_depots, v_plan_type, v_signed_token
    FROM public.core_license_config
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_max_depots := 1;
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
    BEGIN
      v_token_max_depots := NULLIF((v_token_json->>'max_depots')::int, 0);
    EXCEPTION WHEN OTHERS THEN
      v_token_max_depots := NULL;
    END;
  ELSE
    v_plan_type := 'free';
    v_token_max_depots := 1;
  END IF;

  v_limits := public.plan_limits(v_plan_type);
  v_plan_type := COALESCE(v_limits->>'plan', 'free');
  v_plan_max_depots := COALESCE((v_limits->>'max_depots')::int, 1);

  IF v_token_max_depots IS NOT NULL AND v_token_max_depots > 0 THEN
    v_max_depots := LEAST(v_token_max_depots, v_plan_max_depots);
  ELSE
    v_max_depots := v_plan_max_depots;
  END IF;

  IF v_max_depots >= 99999 THEN
    RETURN NEW;
  END IF;

  -- Ne compter QUE les dépôts actifs (les conteneurs ou véhicules fermés ne comptent plus)
  SELECT COUNT(*) INTO v_current_count
  FROM public.stk_depots
  WHERE is_active = true
    AND (TG_OP = 'INSERT' OR id != NEW.id);

  IF v_current_count >= v_max_depots THEN
    RAISE EXCEPTION 'QUOTA_EXCEEDED: Votre licence TOT Stock (%) est limitée à % magasin(s)/dépôt(s) actif(s) maximum. Veuillez mettre à niveau votre forfait.',
      UPPER(COALESCE(v_plan_type, 'GRATUIT')), v_max_depots
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_license_max_depots ON public.stk_depots;
CREATE TRIGGER trg_enforce_license_max_depots
  BEFORE INSERT OR UPDATE OF is_active ON public.stk_depots
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_license_max_depots_quota();

-- -------------------------------------------------------------------------
-- 2. TABLE DES NIVEAUX DE STOCK PAR DÉPÔT : public.stk_stock_levels
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stk_stock_levels (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id TEXT NOT NULL,
  depot_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  min_alert NUMERIC DEFAULT 0,
  rack_location TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_product_depot UNIQUE (product_id, depot_name)
);
ALTER TABLE public.stk_stock_levels ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.stk_stock_levels
  ADD COLUMN IF NOT EXISTS min_alert NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rack_location TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_levels_product ON public.stk_stock_levels(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_levels_depot ON public.stk_stock_levels(depot_name);

-- -------------------------------------------------------------------------
-- 3. MIGRATION DE L'EXISTANT DEPUIS public.stk_products VERS public.stk_stock_levels
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_stk_stock_levels_product_depot ON public.stk_stock_levels (product_id, depot_name);

INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, updated_at)
SELECT 
  p.id::text AS product_id,
  COALESCE(NULLIF(TRIM(p.store_name), ''), 'Dépôt Principal') AS depot_name,
  COALESCE(p.quantity, 0) AS quantity,
  now() AS updated_at
FROM public.stk_products p
WHERE NOT EXISTS (
  SELECT 1 FROM public.stk_stock_levels sl WHERE sl.product_id::text = p.id::text
)
ON CONFLICT (product_id, depot_name) DO NOTHING;

-- -------------------------------------------------------------------------
-- 4. COLONNES depot_name DANS public.stk_movements
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stk_movements') THEN
    ALTER TABLE public.stk_movements
      ADD COLUMN IF NOT EXISTS depot_name TEXT DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS dest_depot_name TEXT DEFAULT NULL;
    CREATE INDEX IF NOT EXISTS idx_stock_movements_depot_name ON public.stk_movements(depot_name);
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 5. FONCTIONS DE SÉCURITÉ ET VISIBILITÉ (can_view_movement)
-- Règle stricte :
-- 1. Rôles 0 et 1 (Super Super Admin, Administrateur) ou perm_mov_view_all voient TOUT.
-- 2. Ses propres mouvements pour chaque utilisateur (user_id = public.current_user_id()).
-- 3. Mouvements du département pour son responsable ou suppléants (core_departments.manager_id / deputy_manager_ids)
--    et NON pour quiconque a perm_kpi_scope_department.
-- 4. Mouvements d'un chantier pour son conducteur ou suppléants (core_projects.manager_id / deputy_manager_ids via site_number).
-- 5. Mouvements de ses dépôts autorisés avec perm_mov_view_depot.
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.is_super_admin() CASCADE;
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((public.current_user_role() = 0), false);
$$;

DROP FUNCTION IF EXISTS public.is_administrator() CASCADE;
CREATE OR REPLACE FUNCTION public.is_administrator()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((public.current_user_role() IN (0, 1)), false);
$$;

-- (pas de DROP de can_view_movement(4 arguments) : des politiques en dépendent ; CREATE OR REPLACE suffit)
DROP FUNCTION IF EXISTS public.can_view_movement(TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.can_view_movement(
  p_mov_user_id TEXT,
  p_mov_department TEXT,
  p_mov_depot TEXT,
  p_site_number TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role INT;
  v_caller_id TEXT;
  v_caller_dept TEXT;
  v_allowed_depots TEXT[];
  v_is_blocked BOOLEAN;
BEGIN
  -- Récupération du profil appelant
  SELECT id::text, role_id, department, allowed_depots, is_blocked
  INTO v_caller_id, v_role, v_caller_dept, v_allowed_depots, v_is_blocked
  FROM public.core_users
  WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
  LIMIT 1;

  IF v_caller_id IS NULL OR v_is_blocked = TRUE THEN
    RETURN FALSE;
  END IF;

  -- 1. Super Admin (rôle 0), Administrateur (rôle 1) ou perm_mov_view_all : visibilité TOTALE
  IF public.is_administrator() OR public.current_user_has_perm('perm_mov_view_all') THEN
    RETURN TRUE;
  END IF;

  -- 2. Ses propres mouvements pour chacun
  IF p_mov_user_id IS NOT NULL AND (p_mov_user_id::text = v_caller_id::text OR p_mov_user_id::text = auth.uid()::text) THEN
    RETURN TRUE;
  END IF;

  -- 3. Mouvements du département pour son responsable ou suppléants
  -- (core_departments.manager_id / deputy_manager_ids, et NON pour quiconque a perm_kpi_scope_department)
  IF p_mov_department IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.core_departments d
      WHERE (d.name::text = p_mov_department::text OR d.id::text = p_mov_department::text)
        AND (
          d.manager_id::text = v_caller_id::text 
          OR (d.deputy_manager_ids IS NOT NULL AND v_caller_id::text = ANY(ARRAY(SELECT unnest(d.deputy_manager_ids)::text)))
        )
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;

  -- 4. Mouvements d'un chantier pour son conducteur de travaux ou suppléants (via site_number)
  IF p_site_number IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.core_projects pr
      WHERE pr.project_number::text = p_site_number::text
        AND (
          pr.manager_id::text = v_caller_id::text 
          OR (pr.deputy_manager_ids IS NOT NULL AND v_caller_id::text = ANY(ARRAY(SELECT unnest(pr.deputy_manager_ids)::text)))
        )
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;

  -- 5. Mouvements de ses dépôts avec perm_mov_view_depot
  IF public.current_user_has_perm('perm_mov_view_depot') THEN
    IF v_allowed_depots IS NULL OR array_length(v_allowed_depots, 1) = 0 OR '*' = ANY(v_allowed_depots) OR 'ALL' = ANY(v_allowed_depots) THEN
      RETURN TRUE;
    END IF;
    IF p_mov_depot IS NOT NULL AND p_mov_depot::text = ANY(v_allowed_depots) THEN
      RETURN TRUE;
    END IF;
  END IF;

  RETURN FALSE;
END;
$$;

-- RLS SELECT et INSERT sur public.stk_movements (purge de toute règle existante avant recréation)
DO $$
DECLARE
  r RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stk_movements') THEN
    ALTER TABLE public.stk_movements ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.stk_movements FROM anon, public;
    GRANT SELECT, INSERT ON TABLE public.stk_movements TO authenticated;

    FOR r IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'stk_movements'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.stk_movements', r.policyname);
    END LOOP;

    CREATE POLICY "Authenticated read stk_movements"
      ON public.stk_movements
      FOR SELECT
      TO authenticated
      USING (public.can_view_movement(user_id::text, department_name::text, depot_name::text, site_number::text));

    CREATE POLICY "Authenticated insert stk_movements"
      ON public.stk_movements
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id::text = public.current_user_id() OR user_id::text = auth.uid()::text);
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 6. DURCISSEMENT RLS SUR public.stk_stock_levels
-- Règle :
-- - Dépôt de type FIXED : visible par tout utilisateur connecté (public.current_user_id() IS NOT NULL).
-- - Dépôt VEHICLE ou CONTAINER : visible par son responsable (manager_id),
--   les utilisateurs qui l'ont dans allowed_depots, le conducteur de travaux
--   du chantier rattaché (core_projects.manager_id / deputy_manager_ids via project_number),
--   et les rôles 0 et 1.
-- -------------------------------------------------------------------------
ALTER TABLE public.stk_stock_levels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stk_stock_levels FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stk_stock_levels TO authenticated;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stk_stock_levels'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.stk_stock_levels', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "Authenticated read stk_stock_levels"
  ON public.stk_stock_levels
  FOR SELECT
  TO authenticated
  USING (
    public.is_administrator()
    OR EXISTS (
      SELECT 1 FROM public.stk_depots d
      WHERE d.name::text = stk_stock_levels.depot_name::text
        AND (
          -- Dépôt FIXED visible par tout utilisateur connecté
          COALESCE(d.type, 'FIXED') = 'FIXED'
          -- Responsable direct du véhicule / conteneur
          OR (d.manager_id IS NOT NULL AND d.manager_id::text = public.current_user_id())
          -- Binôme déclaré sur le véhicule
          OR (d.binome_ids IS NOT NULL AND d.binome_ids::jsonb ? public.current_user_id())
          -- Autorisé explicitement dans allowed_depots de l'utilisateur
          OR EXISTS (
            SELECT 1 FROM public.core_users u
            WHERE u.id::text = public.current_user_id()
              AND (
                u.allowed_depots IS NULL
                OR array_length(u.allowed_depots, 1) = 0
                OR '*' = ANY(u.allowed_depots)
                OR 'ALL' = ANY(u.allowed_depots)
                OR d.name::text = ANY(u.allowed_depots)
              )
          )
          -- Conducteur de travaux ou suppléants du chantier rattaché au conteneur
          OR (
            COALESCE(d.type, 'FIXED') = 'CONTAINER'
            AND d.project_number IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.core_projects pr
              WHERE pr.project_number::text = d.project_number::text
                AND (
                  pr.manager_id::text = public.current_user_id() 
                  OR (pr.deputy_manager_ids IS NOT NULL AND public.current_user_id() = ANY(ARRAY(SELECT unnest(pr.deputy_manager_ids)::text)))
                )
            )
          )
        )
    )
  );

CREATE POLICY "Admin write stk_stock_levels"
  ON public.stk_stock_levels
  FOR ALL
  TO authenticated
  USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_prod_edit'))
  WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_prod_edit'));

-- -------------------------------------------------------------------------
-- 7. NOUVELLE RPC DE MOUVEMENT ATOMIQUE PAR DÉPÔT (process_stock_movement V4)
-- - Pose set_config('app.stock_rpc', 'on', true) dans la transaction pour satisfaire le trigger stk_products.quantity
-- - Verrouille et met à jour stk_stock_levels du dépôt concerné (SELECT FOR UPDATE)
-- - En cas de TRANSFER : décrémente dépôt source ET incrémente dépôt destination
-- - Maintient stk_products.quantity comme la somme totale de tous les dépôts stk_stock_levels
-- - Renseigne depot_name et site_number dans stk_movements
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

  -- 1. Authentification & vérification stricte du profil (ignore utilisateurs bloqués)
  SELECT id::text, role_id, name, trigram, allowed_depots, is_blocked
  INTO v_caller_id, v_caller_role, v_caller_name, v_caller_trigram, v_allowed_depots, v_is_blocked
  FROM public.core_users
  WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
  LIMIT 1;

  IF v_caller_id IS NULL OR v_is_blocked = TRUE THEN
    RAISE EXCEPTION 'User profile not found or blocked' USING ERRCODE = '42501';
  END IF;

  -- Autorisation du trigger de verrouillage de stk_products.quantity dans la transaction
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
      public.is_administrator()
      OR public.current_user_has_perm('perm_mov_out') 
      OR public.current_user_has_perm('perm_prod_movement_direct')
    ) THEN
      RAISE EXCEPTION 'Permission denied: stock outflow rights required (perm_mov_out)' USING ERRCODE = '42501';
    END IF;
  ELSIF v_mov_type IN ('IN', 'RETURN') THEN
    IF NOT (
      public.is_administrator()
      OR public.current_user_has_perm('perm_stock_in') 
      OR public.current_user_has_perm('perm_prod_movement_direct')
    ) THEN
      RAISE EXCEPTION 'Permission denied: stock inflow rights required (perm_stock_in)' USING ERRCODE = '42501';
    END IF;
  ELSIF v_mov_type = 'TRANSFER' THEN
    IF NOT (
      public.is_administrator()
      OR public.current_user_has_perm('perm_stock_transfer')
      OR public.current_user_has_perm('perm_mov_out') 
      OR public.current_user_has_perm('perm_stock_in') 
      OR public.current_user_has_perm('perm_prod_movement_direct')
    ) THEN
      RAISE EXCEPTION 'Permission denied: stock transfer rights required (perm_stock_transfer, perm_mov_out or perm_stock_in)' USING ERRCODE = '42501';
    END IF;
  ELSIF v_mov_type = 'INVENTORY' THEN
    IF NOT (
      public.is_administrator()
      OR public.current_user_has_perm('perm_menu_inventory_audit')
      OR public.current_user_has_perm('perm_inventory_validate')
    ) THEN
      RAISE EXCEPTION 'Permission denied: inventory audit rights required (perm_menu_inventory_audit or perm_inventory_validate)' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown movement type: %', p_type USING ERRCODE = '22023';
  END IF;

  -- 4. Normalisation et validation des dépôts
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

  -- Vérification des droits d'accès aux dépôts (source ET destination) sauf administrateurs (rôles 0 et 1)
  IF NOT public.is_administrator() THEN
    IF v_allowed_depots IS NOT NULL AND array_length(v_allowed_depots, 1) > 0 THEN
      -- Vérification dépôt source
      IF NOT ('*' = ANY(v_allowed_depots) OR 'ALL' = ANY(v_allowed_depots) OR v_source_depot = ANY(v_allowed_depots)) THEN
        RAISE EXCEPTION 'Accès refusé au dépôt source "%". Vos droits ne couvrent pas ce magasin.', v_source_depot USING ERRCODE = '42501';
      END IF;

      -- Vérification dépôt destination si TRANSFER
      IF v_mov_type = 'TRANSFER' AND v_dest_depot IS NOT NULL THEN
        IF NOT ('*' = ANY(v_allowed_depots) OR 'ALL' = ANY(v_allowed_depots) OR v_dest_depot = ANY(v_allowed_depots)) THEN
          RAISE EXCEPTION 'Accès refusé au dépôt destination "%". Vos droits ne couvrent pas ce magasin.', v_dest_depot USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;
  END IF;

  -- 5. Verrouillage FOR UPDATE de l'article dans public.stk_products
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

  -- 6. Initialisation paresseuse et verrouillage FOR UPDATE du niveau de stock dans public.stk_stock_levels (dépôt source)
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

  -- 7. Calcul du nouveau stock dans le dépôt source
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

  -- Mise à jour du stock dans le dépôt source
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

  -- 8. Gestion spécifique du TRANSFER : augmentation du dépôt destination
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

  -- 9. Mise à jour de la quantité totale dans public.stk_products (somme de tous les dépôts)
  SELECT COALESCE(SUM(quantity), 0)
  INTO v_total_product_stock
  FROM public.stk_stock_levels
  WHERE product_id = p_product_id;

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

  -- 10. Insertion dans public.stk_movements et public.core_audit_logs
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
      quantity_changed, reason, site_number, department_name, total_cost, order_number,
      depot_name, dest_depot_name, created_at
    ) VALUES (
      v_mov_id, p_product_id, COALESCE((p_metadata->>'product_ref'), v_product_ref),
      v_caller_id, v_caller_name,
      v_effective_dir,
      v_recorded_qty, COALESCE(p_reason, 'Mouvement de stock'),
      COALESCE(p_project_name, p_reason), p_department, v_total_cost, (p_metadata->>'order_number'),
      v_source_depot, v_dest_depot, now()
    );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'core_audit_logs') THEN
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
  END IF;

  -- 11. Préparation du résultat et enregistrement d'idempotence
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
-- 8. FONCTION SERVEUR POUR LES INDICATEURS DU TABLEAU DE BORD (get_dashboard_kpis)
-- Calcule les totaux en filtrant strictement via can_view_movement
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_dashboard_kpis(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(
  p_scope TEXT DEFAULT 'COMPANY',
  p_depot_filter TEXT DEFAULT 'ALL'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_role INT;
  v_caller_dept TEXT;
  v_caller_allowed TEXT[];
  v_total_value NUMERIC := 0;
  v_total_units NUMERIC := 0;
  v_low_stock_count INT := 0;
  v_out_stock_count INT := 0;
  v_outflow_count INT := 0;
  v_inflow_count INT := 0;
BEGIN
  -- Récupérer l'utilisateur connecté
  SELECT id::text, role_id, department, allowed_depots
  INTO v_caller_id, v_caller_role, v_caller_dept, v_caller_allowed
  FROM public.core_users
  WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
  LIMIT 1;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifié' USING ERRCODE = '42501';
  END IF;

  -- 1. Calcul des statistiques de stock (via stk_stock_levels et stk_products)
  SELECT 
    COALESCE(SUM(sl.quantity * COALESCE(p.unit_price, 0)), 0),
    COALESCE(SUM(sl.quantity), 0),
    COALESCE(COUNT(DISTINCT p.id) FILTER (WHERE sl.quantity > 0 AND sl.quantity <= COALESCE(p.min_stock_alert, 2)), 0),
    COALESCE(COUNT(DISTINCT p.id) FILTER (WHERE sl.quantity = 0), 0)
  INTO v_total_value, v_total_units, v_low_stock_count, v_out_stock_count
  FROM public.stk_stock_levels sl
  JOIN public.stk_products p ON p.id::text = sl.product_id::text
  WHERE (p_depot_filter = 'ALL' OR sl.depot_name = p_depot_filter)
    AND (
      public.is_administrator()
      OR public.current_user_has_perm('perm_mov_view_all')
      OR v_caller_allowed IS NULL 
      OR array_length(v_caller_allowed, 1) = 0 
      OR '*' = ANY(v_caller_allowed) 
      OR sl.depot_name = ANY(v_caller_allowed)
    );

  -- Si l'utilisateur n'a pas le droit de voir la valeur du stock (perm_prod_view_price) ni administrateur
  IF NOT (public.is_administrator() OR public.current_user_has_perm('perm_prod_view_price')) THEN
    v_total_value := 0;
  END IF;

  -- 2. Compteurs de flux respectant STRICTEMENT can_view_movement
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stk_movements') THEN
    SELECT 
      COALESCE(COUNT(*) FILTER (WHERE m.movement_type = 'OUT'), 0),
      COALESCE(COUNT(*) FILTER (WHERE m.movement_type = 'IN'), 0)
    INTO v_outflow_count, v_inflow_count
    FROM public.stk_movements m
    WHERE public.can_view_movement(m.user_id::text, m.department_name, m.depot_name, m.site_number)
      AND (p_depot_filter = 'ALL' OR m.depot_name = p_depot_filter);
  END IF;

  RETURN jsonb_build_object(
    'total_value', v_total_value,
    'total_units', v_total_units,
    'low_stock_count', v_low_stock_count,
    'out_stock_count', v_out_stock_count,
    'outflow_count', v_outflow_count,
    'inflow_count', v_inflow_count,
    'scope', p_scope,
    'depot_filter', p_depot_filter,
    'calculated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_kpis(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_kpis(TEXT, TEXT) TO authenticated;

-- -------------------------------------------------------------------------
-- 9. MISE À JOUR DES RÔLES EXISTANTS : Ajout de perm_mov_view_all et perm_view_all_login_logs au rôle Administrateur (role_id = 1)
-- -------------------------------------------------------------------------
UPDATE public.core_roles
SET permissions = array_append(permissions, 'perm_mov_view_all')
WHERE id::text = '1' AND NOT ('perm_mov_view_all' = ANY(permissions));

UPDATE public.core_roles
SET permissions = array_append(permissions, 'perm_view_all_login_logs')
WHERE id::text = '1' AND NOT ('perm_view_all_login_logs' = ANY(permissions));

-- -------------------------------------------------------------------------
-- 10. HISTORIQUE DES AUDITS D'INVENTAIRE (stk_inventory_audits & stk_inventory_audit_items)
-- Intégration de fix_inventory_audits.sql :
-- - Création idempotente des tables, colonnes et index
-- - Règles RLS strictes :
--   * SELECT / INSERT : rôle 0 ou perm_menu_inventory_audit ou perm_inventory_validate
--   * UPDATE / DELETE : rôle 0 uniquement
--   * anon : zéro accès
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'inventory_audits' AND c.relkind = 'r'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'stk_inventory_audits' AND c.relkind = 'r'
  ) THEN
    DROP VIEW IF EXISTS public.stk_inventory_audits;
    ALTER TABLE public.inventory_audits RENAME TO stk_inventory_audits;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'inventory_audit_items' AND c.relkind = 'r'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'stk_inventory_audit_items' AND c.relkind = 'r'
  ) THEN
    DROP VIEW IF EXISTS public.stk_inventory_audit_items;
    ALTER TABLE public.inventory_audit_items RENAME TO stk_inventory_audit_items;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.stk_inventory_audits (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  depot_name TEXT,
  auditor_id TEXT,
  auditor_name TEXT,
  validator_id TEXT,
  validator_name TEXT,
  status TEXT DEFAULT 'COMPLETED',
  items_counted INT DEFAULT 0,
  items_with_diff INT DEFAULT 0,
  total_diff_cost NUMERIC(12,2) DEFAULT 0,
  audit_notes TEXT,
  total_references INT DEFAULT 0,
  counted_references INT DEFAULT 0,
  discrepancies_count INT DEFAULT 0,
  positive_diff_value NUMERIC(12,2) DEFAULT 0,
  negative_diff_value NUMERIC(12,2) DEFAULT 0,
  net_diff_value NUMERIC(12,2) DEFAULT 0,
  notes TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ DEFAULT now(),
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.stk_inventory_audits
  ADD COLUMN IF NOT EXISTS depot_name TEXT,
  ADD COLUMN IF NOT EXISTS auditor_id TEXT,
  ADD COLUMN IF NOT EXISTS auditor_name TEXT,
  ADD COLUMN IF NOT EXISTS validator_id TEXT,
  ADD COLUMN IF NOT EXISTS validator_name TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'COMPLETED',
  ADD COLUMN IF NOT EXISTS items_counted INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS items_with_diff INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_diff_cost NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS audit_notes TEXT,
  ADD COLUMN IF NOT EXISTS total_references INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS counted_references INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discrepancies_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS positive_diff_value NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS negative_diff_value NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_diff_value NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_stk_inventory_audits_created_at
  ON public.stk_inventory_audits (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stk_inventory_audits_depot_name
  ON public.stk_inventory_audits (depot_name);

CREATE TABLE IF NOT EXISTS public.stk_inventory_audit_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  audit_id TEXT NOT NULL REFERENCES public.stk_inventory_audits(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_ref TEXT,
  product_name TEXT,
  theoretical_qty NUMERIC(12,2) DEFAULT 0,
  physical_count NUMERIC(12,2) DEFAULT 0,
  difference NUMERIC(12,2) DEFAULT 0,
  unit_price NUMERIC(12,2) DEFAULT 0,
  diff_cost NUMERIC(12,2) DEFAULT 0,
  scanned_barcode TEXT,
  scanned_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.stk_inventory_audit_items
  ADD COLUMN IF NOT EXISTS audit_id TEXT,
  ADD COLUMN IF NOT EXISTS product_id TEXT,
  ADD COLUMN IF NOT EXISTS product_ref TEXT,
  ADD COLUMN IF NOT EXISTS product_name TEXT,
  ADD COLUMN IF NOT EXISTS theoretical_qty NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS physical_count NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS difference NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS diff_cost NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scanned_barcode TEXT,
  ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_stk_inventory_audit_items_audit_id
  ON public.stk_inventory_audit_items (audit_id);
CREATE INDEX IF NOT EXISTS idx_stk_inventory_audit_items_product_id
  ON public.stk_inventory_audit_items (product_id);

ALTER TABLE public.stk_inventory_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stk_inventory_audit_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stk_inventory_audits FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.stk_inventory_audit_items FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stk_inventory_audits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stk_inventory_audit_items TO authenticated;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stk_inventory_audits'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.stk_inventory_audits', r.policyname);
  END LOOP;

  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stk_inventory_audit_items'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.stk_inventory_audit_items', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "Authenticated read stk_inventory_audits"
  ON public.stk_inventory_audits
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_role() = 0
    OR public.current_user_has_perm('perm_menu_inventory_audit')
    OR public.current_user_has_perm('perm_inventory_validate')
  );

CREATE POLICY "Authenticated insert stk_inventory_audits"
  ON public.stk_inventory_audits
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_role() = 0
    OR public.current_user_has_perm('perm_menu_inventory_audit')
    OR public.current_user_has_perm('perm_inventory_validate')
  );

CREATE POLICY "SuperAdmin update stk_inventory_audits"
  ON public.stk_inventory_audits
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() = 0)
  WITH CHECK (public.current_user_role() = 0);

CREATE POLICY "SuperAdmin delete stk_inventory_audits"
  ON public.stk_inventory_audits
  FOR DELETE
  TO authenticated
  USING (public.current_user_role() = 0);

CREATE POLICY "Authenticated read stk_inventory_audit_items"
  ON public.stk_inventory_audit_items
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_role() = 0
    OR public.current_user_has_perm('perm_menu_inventory_audit')
    OR public.current_user_has_perm('perm_inventory_validate')
  );

CREATE POLICY "Authenticated insert stk_inventory_audit_items"
  ON public.stk_inventory_audit_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_role() = 0
    OR public.current_user_has_perm('perm_menu_inventory_audit')
    OR public.current_user_has_perm('perm_inventory_validate')
  );

CREATE POLICY "SuperAdmin update stk_inventory_audit_items"
  ON public.stk_inventory_audit_items
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() = 0)
  WITH CHECK (public.current_user_role() = 0);

CREATE POLICY "SuperAdmin delete stk_inventory_audit_items"
  ON public.stk_inventory_audit_items
  FOR DELETE
  TO authenticated
  USING (public.current_user_role() = 0);

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
