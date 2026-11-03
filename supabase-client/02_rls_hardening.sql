-- =========================================================================
-- TOT STOCK - SCRIPT 02 : RLS HARDENING (02_rls_hardening.sql)
-- Durcissement strict des règles Row Level Security (RLS)
-- Blocage total de 'anon', lecture seule de license_config,
-- interdiction des écritures directes sur users, contrôle strict des commandes,
-- protection absolue de products.quantity contre toute écriture directe.
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
    RAISE EXCEPTION 'Prérequis manquant (02_rls_hardening.sql) : La table public.users est absente. Exécutez d''abord le schéma de base et 01_auth_link.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'auth_user_id'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (02_rls_hardening.sql) : La colonne public.users.auth_user_id est absente. Exécutez d''abord 01_auth_link.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'handle_auth_user_created'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (02_rls_hardening.sql) : La fonction public.handle_auth_user_created() est absente. Exécutez d''abord 01_auth_link.sql.';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 0.0 Tables structurelles de base alignées sur 20261003_complete_tot_stock_schema.sql
-- Tous les identifiants utilisateur sont en TEXT (Point 3).
-- -------------------------------------------------------------------------
-- Forme unique de license_config (celle qu'écrit l'Edge Function sync-license) :
-- id TEXT ('active_license'), license_key, plan_type, modules, max_depots, organization_name, signed_token, offline_until.
CREATE TABLE IF NOT EXISTS public.license_config (
  id TEXT PRIMARY KEY DEFAULT 'active_license',
  license_key TEXT,
  plan_type TEXT NOT NULL DEFAULT 'free',
  modules TEXT[] NOT NULL DEFAULT ARRAY['stock']::TEXT[],
  max_depots INT NOT NULL DEFAULT 1,
  organization_name TEXT,
  signed_token TEXT,
  offline_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Mise à niveau additive des installations antérieures (id entier, colonne plan, etc.)
DO $$
DECLARE
  v_id_type TEXT;
BEGIN
  SELECT data_type INTO v_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'license_config' AND column_name = 'id';

  IF v_id_type IS NOT NULL AND v_id_type <> 'text' THEN
    ALTER TABLE public.license_config DROP CONSTRAINT IF EXISTS license_config_id_check;
    ALTER TABLE public.license_config ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE public.license_config ALTER COLUMN id TYPE TEXT USING (
      CASE WHEN id::text = '1' THEN 'active_license' ELSE id::text END
    );
    ALTER TABLE public.license_config ALTER COLUMN id SET DEFAULT 'active_license';
  END IF;
END $$;

ALTER TABLE public.license_config
  ADD COLUMN IF NOT EXISTS license_key TEXT,
  ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS modules TEXT[] DEFAULT ARRAY['stock']::TEXT[],
  ADD COLUMN IF NOT EXISTS max_depots INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS organization_name TEXT,
  ADD COLUMN IF NOT EXISTS signed_token TEXT,
  ADD COLUMN IF NOT EXISTS offline_until TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'license_config' AND column_name = 'plan'
  ) THEN
    EXECUTE 'UPDATE public.license_config SET plan_type = COALESCE(NULLIF(plan_type, ''free''), plan, ''free'') WHERE plan IS NOT NULL';
  END IF;
END $$;

INSERT INTO public.license_config (id, license_key, plan_type, modules, max_depots)
VALUES ('active_license', 'TOT-STOCK-FREE-COMMUNITY', 'free', ARRAY['stock']::TEXT[], 1)
ON CONFLICT (id) DO NOTHING;

-- 1. Fonction unique des plafonds techniques par formule : plan_limits(plan)
-- Source de vérité unique pour les plafonds par formule (v23).
-- Les plafonds techniques ne sont JAMAIS stockés par client.
CREATE OR REPLACE FUNCTION public.plan_limits(p_plan TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_norm TEXT := LOWER(TRIM(COALESCE(p_plan, 'free')));
BEGIN
  IF v_norm IN ('sta', 'standard', 'starter', 'artisan') THEN
    RETURN jsonb_build_object(
      'plan', 'sta',
      'max_references', 300,
      'max_depots', 3,
      'max_users', 99999,
      'default_modules', jsonb_build_array('stock')
    );
  ELSIF v_norm IN ('pro', 'professionnel', 'pme') THEN
    RETURN jsonb_build_object(
      'plan', 'pro',
      'max_references', 1000,
      'max_depots', 10,
      'max_users', 99999,
      'default_modules', jsonb_build_array('stock', 'outils', 'rapports')
    );
  ELSIF v_norm IN ('ent', 'entreprise', 'enterprise') THEN
    RETURN jsonb_build_object(
      'plan', 'ent',
      'max_references', 99999,
      'max_depots', 99999,
      'max_users', 99999,
      'default_modules', jsonb_build_array('stock', 'outils', 'formation', 'rapports')
    );
  ELSE
    RETURN jsonb_build_object(
      'plan', 'free',
      'max_references', 50,
      'max_depots', 1,
      'max_users', 99999,
      'default_modules', jsonb_build_array('stock')
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.plan_limits(TEXT) TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.roles (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigram TEXT,
  email TEXT,
  department TEXT,
  pin TEXT DEFAULT '',
  pin_hash TEXT DEFAULT '',
  role_id BIGINT REFERENCES public.roles(id) DEFAULT 4,
  is_blocked BOOLEAN DEFAULT false,
  allowed_depots TEXT[] DEFAULT '{}'::TEXT[],
  must_change_pin BOOLEAN DEFAULT false,
  is_preparer BOOLEAN DEFAULT false,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.departments (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  manager_id TEXT,
  deputy_manager_ids TEXT[] DEFAULT '{}',
  allow_global_kpis BOOLEAN DEFAULT false,
  is_preparer_dept BOOLEAN DEFAULT false,
  require_order_approval BOOLEAN DEFAULT false,
  order_approval_threshold NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.projects (
  id BIGSERIAL PRIMARY KEY,
  department_id BIGINT REFERENCES public.departments(id),
  project_number TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL,
  manager_id TEXT,
  deputy_manager_ids TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sub_categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.depots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  address TEXT,
  description TEXT,
  type TEXT DEFAULT 'FIXED',
  vehicle_reg TEXT,
  manager_id TEXT,
  container_ref TEXT,
  project_number TEXT,
  pickup_zones TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  manufacturer_ref TEXT,
  barcode TEXT,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  sub_category_id BIGINT REFERENCES public.sub_categories(id),
  unit_price NUMERIC(10,2) DEFAULT 0,
  description TEXT,
  tags TEXT,
  supplier_1_name TEXT,
  ref_supplier_1 TEXT,
  supplier_2_name TEXT,
  ref_supplier_2 TEXT,
  store_name TEXT,
  room_name TEXT,
  shelf_name TEXT,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
  min_stock_alert NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.movements (
  id TEXT PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id TEXT PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS public.material_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  site_number TEXT NOT NULL,
  site_name TEXT,
  depot_name TEXT,
  user_id TEXT,
  requester_id TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  requester_department TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('WAITING_APPROVAL', 'PENDING', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED', 'REJECTED')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  total_cost NUMERIC(10,2) DEFAULT 0,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  rejected_by TEXT,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  pickup_zone TEXT,
  ready_qr_code TEXT,
  signature_data TEXT,
  proof_photo_url TEXT,
  is_edited BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_at TIMESTAMPTZ,
  preparer_id TEXT,
  preparer_name TEXT,
  pickup_delegate_id TEXT,
  ready_at TIMESTAMPTZ,
  collected_at TIMESTAMPTZ,
  collected_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  timestamp TIMESTAMPTZ DEFAULT now(),
  user_id TEXT,
  user_name TEXT,
  action TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  severity TEXT DEFAULT 'INFO',
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 0.1 Table stock_levels
CREATE TABLE IF NOT EXISTS public.stock_levels (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id TEXT NOT NULL,
  depot_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  min_stock NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.stock_levels ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_levels_product_depot ON public.stock_levels (product_id, depot_name);
CREATE INDEX IF NOT EXISTS idx_stock_levels_depot ON public.stock_levels (depot_name);

-- 0.2 Colonnes requises sécurisées et conversion additive des identifiants utilisateur en TEXT
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
    ALTER TABLE public.users 
      ADD COLUMN IF NOT EXISTS trigram TEXT,
      ADD COLUMN IF NOT EXISTS department TEXT,
      ADD COLUMN IF NOT EXISTS role_id BIGINT DEFAULT 4,
      ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS allowed_depots TEXT[] DEFAULT '{}'::TEXT[],
      ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_preparer BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS auth_user_id UUID,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'material_orders') THEN
    ALTER TABLE public.material_orders 
      ADD COLUMN IF NOT EXISTS user_id TEXT,
      ADD COLUMN IF NOT EXISTS requester_id TEXT,
      ADD COLUMN IF NOT EXISTS requester_name TEXT,
      ADD COLUMN IF NOT EXISTS requester_department TEXT,
      ADD COLUMN IF NOT EXISTS pickup_delegate_id TEXT,
      ADD COLUMN IF NOT EXISTS pickup_delegate_name TEXT,
      ADD COLUMN IF NOT EXISTS pickup_delegate_department TEXT,
      ADD COLUMN IF NOT EXISTS pickup_delegate_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS pickup_delegate_by TEXT,
      ADD COLUMN IF NOT EXISTS pickup_delegate_notes TEXT,
      ADD COLUMN IF NOT EXISTS pickup_zone TEXT,
      ADD COLUMN IF NOT EXISTS ready_qr_code TEXT,
      ADD COLUMN IF NOT EXISTS approved_by TEXT,
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS rejected_by TEXT,
      ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
      ADD COLUMN IF NOT EXISTS preparer_id TEXT,
      ADD COLUMN IF NOT EXISTS preparer_name TEXT,
      ADD COLUMN IF NOT EXISTS collected_by TEXT,
      ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS depot_name TEXT,
      ADD COLUMN IF NOT EXISTS site_number TEXT,
      ADD COLUMN IF NOT EXISTS site_name TEXT,
      ADD COLUMN IF NOT EXISTS notes TEXT;

    CREATE INDEX IF NOT EXISTS idx_material_orders_delegate ON public.material_orders (pickup_delegate_id);
    CREATE INDEX IF NOT EXISTS idx_material_orders_preparer ON public.material_orders (preparer_id);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'movements') THEN
    ALTER TABLE public.movements 
      ADD COLUMN IF NOT EXISTS user_id TEXT,
      ADD COLUMN IF NOT EXISTS depot_name TEXT,
      ADD COLUMN IF NOT EXISTS dest_depot_name TEXT,
      ADD COLUMN IF NOT EXISTS site_number TEXT,
      ADD COLUMN IF NOT EXISTS department_name TEXT,
      ADD COLUMN IF NOT EXISTS total_cost NUMERIC(12, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS order_number TEXT;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stock_movements') THEN
    ALTER TABLE public.stock_movements 
      ADD COLUMN IF NOT EXISTS user_id TEXT,
      ADD COLUMN IF NOT EXISTS depot_name TEXT,
      ADD COLUMN IF NOT EXISTS dest_depot_name TEXT,
      ADD COLUMN IF NOT EXISTS site_number TEXT,
      ADD COLUMN IF NOT EXISTS department_name TEXT,
      ADD COLUMN IF NOT EXISTS total_cost NUMERIC(12, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS order_number TEXT;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'departments') THEN
    ALTER TABLE public.departments 
      ADD COLUMN IF NOT EXISTS manager_id TEXT,
      ADD COLUMN IF NOT EXISTS deputy_manager_ids TEXT[] DEFAULT '{}';

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'departments' AND column_name = 'deputy_manager_ids'
        AND udt_name IN ('_int4', '_int8', '_int2')
    ) THEN
      ALTER TABLE public.departments ALTER COLUMN deputy_manager_ids DROP DEFAULT;
      ALTER TABLE public.departments ALTER COLUMN deputy_manager_ids TYPE TEXT[] USING deputy_manager_ids::text[];
      ALTER TABLE public.departments ALTER COLUMN deputy_manager_ids SET DEFAULT '{}';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'projects') THEN
    ALTER TABLE public.projects 
      ADD COLUMN IF NOT EXISTS manager_id TEXT,
      ADD COLUMN IF NOT EXISTS deputy_manager_ids TEXT[] DEFAULT '{}';

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'deputy_manager_ids'
        AND udt_name IN ('_int4', '_int8', '_int2')
    ) THEN
      ALTER TABLE public.projects ALTER COLUMN deputy_manager_ids DROP DEFAULT;
      ALTER TABLE public.projects ALTER COLUMN deputy_manager_ids TYPE TEXT[] USING deputy_manager_ids::text[];
      ALTER TABLE public.projects ALTER COLUMN deputy_manager_ids SET DEFAULT '{}';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'depots') THEN
    ALTER TABLE public.depots 
      ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'FIXED',
      ADD COLUMN IF NOT EXISTS vehicle_reg TEXT,
      ADD COLUMN IF NOT EXISTS manager_id TEXT,
      ADD COLUMN IF NOT EXISTS container_ref TEXT,
      ADD COLUMN IF NOT EXISTS project_number TEXT,
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 1. FONCTIONS UTILITAIRES DE SÉCURITÉ (SECURITY DEFINER)
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.current_user_id() CASCADE;
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id::text FROM public.users WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false LIMIT 1;
$$;

DROP FUNCTION IF EXISTS public.current_user_role() CASCADE;
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role_id FROM public.users WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false LIMIT 1;
$$;

DROP FUNCTION IF EXISTS public.current_user_has_perm(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.current_user_has_perm(p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_id INT;
  v_perms TEXT[];
BEGIN
  SELECT role_id INTO v_role_id FROM public.users WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false LIMIT 1;
  IF v_role_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF v_role_id = 0 THEN
    RETURN TRUE;
  END IF;
  SELECT permissions INTO v_perms FROM public.roles WHERE id::text = v_role_id::text LIMIT 1;
  IF v_perms IS NOT NULL AND ('*' = ANY(v_perms) OR p_perm = ANY(v_perms)) THEN
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$$;

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
  SELECT id::text, role_id, department, allowed_depots, is_blocked
  INTO v_caller_id, v_role, v_caller_dept, v_allowed_depots, v_is_blocked
  FROM public.users
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
  IF p_mov_department IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.departments d
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
      SELECT 1 FROM public.projects pr
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

-- -------------------------------------------------------------------------
-- 2. RÉVOCATION DE L'ANCIENNE RPC DE SYNCHRONISATION DE LICENCE
-- -------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS func_identity
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'sync_verified_license_token'
  LOOP
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || r.func_identity || ' FROM anon, authenticated, public';
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 3. DURCISSEMENT TABLE : public.users (Sécurité V18)
-- (Révocation totale pour anon, GRANT SELECT ciblé sur les colonnes sûres
-- (JAMAIS pin ni pin_hash) uniquement pour authenticated. Aucune écriture client directe,
-- aucun annuaire anonyme.)
-- -------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon users" ON public.users;
DROP POLICY IF EXISTS "Users write self" ON public.users;
DROP POLICY IF EXISTS "Users insert self" ON public.users;
DROP POLICY IF EXISTS "Users update self" ON public.users;
DROP POLICY IF EXISTS "Users delete self" ON public.users;
DROP POLICY IF EXISTS "Authenticated read users" ON public.users;
DROP POLICY IF EXISTS "Login directory read users" ON public.users;
DROP POLICY IF EXISTS "Users insert and update own or admin" ON public.users;

-- Révocation de tout privilège direct et ré-attribution granulaire des colonnes sécurisées à authenticated uniquement
REVOKE ALL ON TABLE public.users FROM anon, authenticated, public;
GRANT SELECT (
  id, name, trigram, email, department, role_id, is_blocked,
  allowed_depots, must_change_pin, is_preparer, auth_user_id, created_at, updated_at
) ON TABLE public.users TO authenticated;

-- Policy unique de lecture pour les utilisateurs authentifiés (aucun accès anonyme, aucune écriture directe)
CREATE POLICY "Authenticated read users"
  ON public.users
  FOR SELECT
  TO authenticated
  USING (public.current_user_id() IS NOT NULL);

-- Suppression définitive des RPC d'annuaire anonyme (V18 : connexion par e-mail obligatoire)
DROP FUNCTION IF EXISTS public.get_login_users_directory() CASCADE;
DROP FUNCTION IF EXISTS public.get_login_directory() CASCADE;

-- -------------------------------------------------------------------------
-- 4. DURCISSEMENT TABLE : public.license_config
-- (Lecture réservée aux utilisateurs authentifiés, écritures strictement réservées
-- au service_role via l'Edge Function sync-license. Plafonds techniques via plan_limits(plan).)
-- -------------------------------------------------------------------------
-- (la table license_config est créée et alignée en début de script)

-- Conversion automatique et idempotente des alias vers les codes canoniques (artisan, starter, standard -> sta ; pme, professionnel -> pro ; enterprise, entreprise -> ent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'license_config' AND column_name = 'plan'
  ) THEN
    UPDATE public.license_config
    SET plan = CASE
        WHEN LOWER(TRIM(plan)) IN ('artisan', 'standard', 'starter') THEN 'sta'
        WHEN LOWER(TRIM(plan)) IN ('pme', 'professionnel') THEN 'pro'
        WHEN LOWER(TRIM(plan)) IN ('enterprise', 'entreprise') THEN 'ent'
        ELSE LOWER(TRIM(plan))
      END
    WHERE LOWER(TRIM(plan)) IN ('artisan', 'standard', 'starter', 'pme', 'professionnel', 'enterprise', 'entreprise');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'license_config' AND column_name = 'plan_type'
  ) THEN
    EXECUTE $upd$
      UPDATE public.license_config
      SET plan_type = CASE
          WHEN LOWER(TRIM(plan_type)) IN ('artisan', 'standard', 'starter') THEN 'sta'
          WHEN LOWER(TRIM(plan_type)) IN ('pme', 'professionnel') THEN 'pro'
          WHEN LOWER(TRIM(plan_type)) IN ('enterprise', 'entreprise') THEN 'ent'
          ELSE LOWER(TRIM(plan_type))
        END
      WHERE LOWER(TRIM(plan_type)) IN ('artisan', 'standard', 'starter', 'pme', 'professionnel', 'enterprise', 'entreprise')
    $upd$;
  END IF;
END $$;

ALTER TABLE public.license_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon license_config" ON public.license_config;
DROP POLICY IF EXISTS "Allow authenticated write license_config" ON public.license_config;
DROP POLICY IF EXISTS "Authenticated read license_config" ON public.license_config;
DROP POLICY IF EXISTS "Anon read license_config" ON public.license_config;
DROP POLICY IF EXISTS "Authenticated write license_config" ON public.license_config;

REVOKE ALL ON TABLE public.license_config FROM anon, public;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.license_config FROM authenticated;
GRANT SELECT ON TABLE public.license_config TO authenticated;

CREATE POLICY "Authenticated read license_config"
  ON public.license_config
  FOR SELECT
  TO authenticated
  USING (true);

-- -------------------------------------------------------------------------
-- 5. DURCISSEMENT TABLES : public.app_settings & public.company_settings
-- (Création si absentes, synchronisation mutuelle, anon peut lire les clés publiques & la licence société)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.company_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insertion de la devise par défaut si vide
INSERT INTO public.app_settings (key, value)
VALUES ('company_currency', 'EUR')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.company_settings (key, value)
VALUES ('company_currency', 'EUR')
ON CONFLICT (key) DO NOTHING;

-- RLS & Policies pour app_settings
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Anon public settings" ON public.app_settings;
DROP POLICY IF EXISTS "Authenticated read app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admin write app_settings" ON public.app_settings;

CREATE POLICY "Anon public settings"
  ON public.app_settings
  FOR SELECT
  TO anon
  USING (key IN ('company_currency', 'company_name', 'company_logo', 'app_logo_url'));

CREATE POLICY "Authenticated read app_settings"
  ON public.app_settings
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_id() IS NOT NULL
    AND key NOT IN ('smtp_pass', 'brevo_api_key', 'sendinblue_api_key')
  );

CREATE POLICY "Admin write app_settings"
  ON public.app_settings
  FOR ALL
  TO authenticated
  USING (
    public.current_user_role() IN (0, 1, 5, 8)
    OR public.current_user_has_perm('perm_config_db')
    OR public.current_user_has_perm('perm_manage_users')
    OR (public.current_user_id() IS NOT NULL AND key IN ('company_orders_sync', 'company_user_baskets'))
  )
  WITH CHECK (
    public.current_user_role() IN (0, 1, 5, 8)
    OR public.current_user_has_perm('perm_config_db')
    OR public.current_user_has_perm('perm_manage_users')
    OR (public.current_user_id() IS NOT NULL AND key IN ('company_orders_sync', 'company_user_baskets'))
  );

-- RLS & Policies pour company_settings
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon company_settings" ON public.company_settings;
DROP POLICY IF EXISTS "Anon public company_settings" ON public.company_settings;
DROP POLICY IF EXISTS "Authenticated read company_settings" ON public.company_settings;
DROP POLICY IF EXISTS "Admin write company_settings" ON public.company_settings;

CREATE POLICY "Anon public company_settings"
  ON public.company_settings
  FOR SELECT
  TO anon
  USING (key IN ('company_currency', 'company_name', 'company_logo', 'app_logo_url'));

CREATE POLICY "Authenticated read company_settings"
  ON public.company_settings
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_id() IS NOT NULL
    AND key NOT IN ('smtp_pass', 'brevo_api_key', 'sendinblue_api_key')
  );

CREATE POLICY "Admin write company_settings"
  ON public.company_settings
  FOR ALL
  TO authenticated
  USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_config_db'))
  WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_config_db'));

-- Trigger de synchronisation automatique bidirectionnelle entre app_settings et company_settings
CREATE OR REPLACE FUNCTION public.sync_app_and_company_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'app_settings' THEN
    INSERT INTO public.company_settings (key, value, updated_at)
    VALUES (NEW.key, NEW.value, NEW.updated_at)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
  ELSIF TG_TABLE_NAME = 'company_settings' THEN
    INSERT INTO public.app_settings (key, value, updated_at)
    VALUES (NEW.key, NEW.value, NEW.updated_at)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_app_to_company ON public.app_settings;
CREATE TRIGGER trg_sync_app_to_company
  AFTER INSERT OR UPDATE ON public.app_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_app_and_company_settings();

DROP TRIGGER IF EXISTS trg_sync_company_to_app ON public.company_settings;
CREATE TRIGGER trg_sync_company_to_app
  AFTER INSERT OR UPDATE ON public.company_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_app_and_company_settings();

-- -------------------------------------------------------------------------
-- 6. DURCISSEMENT TABLES : public.movements & public.stock_movements
-- (Lecture régie par can_view_movement, insertion avec user_id = public.current_user_id())
-- -------------------------------------------------------------------------
ALTER TABLE public.movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.movements FROM anon, public;
DROP POLICY IF EXISTS "Allow anon movements" ON public.movements;
DROP POLICY IF EXISTS "Authenticated read movements" ON public.movements;
DROP POLICY IF EXISTS "Authenticated insert movements" ON public.movements;

CREATE POLICY "Authenticated read movements"
  ON public.movements
  FOR SELECT
  TO authenticated
  USING (public.can_view_movement(user_id::text, department_name::text, depot_name::text, site_number::text));

CREATE POLICY "Authenticated insert movements"
  ON public.movements
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id::text = public.current_user_id() OR user_id::text = auth.uid()::text);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stock_movements FROM anon, public;
DROP POLICY IF EXISTS "Allow anon stock_movements" ON public.stock_movements;
DROP POLICY IF EXISTS "Authenticated read stock_movements" ON public.stock_movements;
DROP POLICY IF EXISTS "Authenticated insert stock_movements" ON public.stock_movements;

CREATE POLICY "Authenticated read stock_movements"
  ON public.stock_movements
  FOR SELECT
  TO authenticated
  USING (public.can_view_movement(user_id::text, department_name::text, depot_name::text, site_number::text));

CREATE POLICY "Authenticated insert stock_movements"
  ON public.stock_movements
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id::text = public.current_user_id() OR user_id::text = auth.uid()::text);

-- -------------------------------------------------------------------------
-- 7. DURCISSEMENT TABLE : public.products & SOURCE DE VÉRITÉ DU STOCK
-- (Interdiction formelle de toute écriture directe de products.quantity par les clients.
-- Seules les transactions système (process_stock_movement via app.stock_rpc='on' ou auth.uid() IS NULL)
-- peuvent modifier products.quantity, qui est maintenue égale à la somme de stock_levels.)
-- -------------------------------------------------------------------------
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.products FROM anon, public;
DROP POLICY IF EXISTS "Allow anon products" ON public.products;
DROP POLICY IF EXISTS "Authenticated read products" ON public.products;
DROP POLICY IF EXISTS "Admin write products" ON public.products;
DROP POLICY IF EXISTS "Operator quantity update products" ON public.products;

CREATE POLICY "Authenticated read products"
  ON public.products
  FOR SELECT
  TO authenticated
  USING (public.current_user_id() IS NOT NULL);

CREATE POLICY "Admin write products"
  ON public.products
  FOR ALL
  TO authenticated
  USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_prod_edit') OR public.current_user_has_perm('perm_action_create_prod'))
  WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_prod_edit') OR public.current_user_has_perm('perm_action_create_prod'));

-- Trigger BEFORE UPDATE : Interdiction stricte de modifier directement products.quantity
DROP FUNCTION IF EXISTS public.check_product_quantity_update() CASCADE;
CREATE OR REPLACE FUNCTION public.check_product_quantity_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
    IF auth.uid() IS NOT NULL AND current_setting('app.stock_rpc', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Écriture directe de products.quantity interdite. Les quantités doivent être modifiées exclusivement via process_stock_movement().'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_product_quantity_update ON public.products;
CREATE TRIGGER trg_check_product_quantity_update
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.check_product_quantity_update();

-- Test de cohérence : products.quantity doit toujours égaler la somme de stock_levels
DROP FUNCTION IF EXISTS public.check_stock_consistency() CASCADE;
CREATE OR REPLACE FUNCTION public.check_stock_consistency()
RETURNS TABLE (
  product_id TEXT,
  product_ref TEXT,
  product_quantity NUMERIC,
  stock_levels_sum NUMERIC,
  is_consistent BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    p.id::text AS product_id,
    p.reference::text AS product_ref,
    p.quantity AS product_quantity,
    COALESCE(SUM(sl.quantity), 0) AS stock_levels_sum,
    (p.quantity = COALESCE(SUM(sl.quantity), 0)) AS is_consistent
  FROM public.products p
  LEFT JOIN public.stock_levels sl ON sl.product_id::text = p.id::text
  GROUP BY p.id, p.reference, p.quantity;
$$;

-- -------------------------------------------------------------------------
-- 8. DURCISSEMENT TABLE : public.material_orders
-- (Suppression de toute policy USING (true), policy ciblée pour le demandeur,
-- préparateur affecté, délégué de retrait, approbateurs du département et perm_menu_order_prep.
-- Trigger BEFORE UPDATE imposant la machine à états de transition_order_status,
-- interdisant l'auto-approbation sauf rôle 0, gelant les commandes terminées,
-- et limitant les colonnes modifiables par le simple demandeur.)
-- -------------------------------------------------------------------------
ALTER TABLE public.material_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon material_orders" ON public.material_orders;
DROP POLICY IF EXISTS "Authenticated read material_orders" ON public.material_orders;
DROP POLICY IF EXISTS "Authenticated insert material_orders" ON public.material_orders;
DROP POLICY IF EXISTS "Authenticated update material_orders" ON public.material_orders;
DROP POLICY IF EXISTS "Allow delete material_orders" ON public.material_orders;

CREATE POLICY "Authenticated read material_orders"
  ON public.material_orders
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_role() IN (0, 1, 2, 6, 7, 8)
    OR requester_id::text = public.current_user_id()
    OR (preparer_id IS NOT NULL AND preparer_id::text = public.current_user_id())
    OR (pickup_delegate_id IS NOT NULL AND pickup_delegate_id::text = public.current_user_id())
    OR public.current_user_has_perm('perm_order_approve')
    OR public.current_user_has_perm('perm_orders_manage')
    OR public.current_user_has_perm('perm_menu_order_prep')
  );

CREATE POLICY "Authenticated insert material_orders"
  ON public.material_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_id() IS NOT NULL
    AND status IN ('WAITING_APPROVAL', 'PENDING')
  );

CREATE POLICY "Authenticated update material_orders"
  ON public.material_orders
  FOR UPDATE
  TO authenticated
  USING (
    public.current_user_role() IN (0, 1, 2, 6, 7, 8)
    OR requester_id::text = public.current_user_id()
    OR (preparer_id IS NOT NULL AND preparer_id::text = public.current_user_id())
    OR (pickup_delegate_id IS NOT NULL AND pickup_delegate_id::text = public.current_user_id())
    OR public.current_user_has_perm('perm_order_approve')
    OR public.current_user_has_perm('perm_orders_manage')
    OR public.current_user_has_perm('perm_menu_order_prep')
    OR public.current_user_has_perm('perm_order_assign')
    OR public.current_user_has_perm('perm_order_mark_ready')
    OR public.current_user_has_perm('perm_order_mark_collected')
    OR public.current_user_has_perm('perm_order_cancel')
  )
  WITH CHECK (
    public.current_user_role() IN (0, 1, 2, 6, 7, 8)
    OR requester_id::text = public.current_user_id()
    OR (preparer_id IS NOT NULL AND preparer_id::text = public.current_user_id())
    OR (pickup_delegate_id IS NOT NULL AND pickup_delegate_id::text = public.current_user_id())
    OR public.current_user_has_perm('perm_order_approve')
    OR public.current_user_has_perm('perm_orders_manage')
    OR public.current_user_has_perm('perm_menu_order_prep')
    OR public.current_user_has_perm('perm_order_assign')
    OR public.current_user_has_perm('perm_order_mark_ready')
    OR public.current_user_has_perm('perm_order_mark_collected')
    OR public.current_user_has_perm('perm_order_cancel')
  );

-- Trigger BEFORE UPDATE : machine à états, interdiction d'auto-approbation,
-- gel des commandes terminées, restriction des colonnes modifiables par le demandeur.
DROP FUNCTION IF EXISTS public.check_material_orders_update() CASCADE;
CREATE OR REPLACE FUNCTION public.check_material_orders_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cid TEXT := public.current_user_id();
  v_crole INT := public.current_user_role();
  v_is_approver BOOLEAN := false;
  v_is_prep BOOLEAN := false;
BEGIN
  -- 1. Si modification déclenchée par un service interne ou mode PIN (auth.uid() IS NULL ou v_cid IS NULL), laisser passer
  IF auth.uid() IS NULL OR v_cid IS NULL THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- 2. Gel strict des commandes terminées (COLLECTED, CANCELLED, REJECTED)
  IF OLD.status IN ('COLLECTED', 'CANCELLED', 'REJECTED') THEN
    RAISE EXCEPTION 'Commande % déjà clôturée (%): aucune modification autorisée.',
      OLD.order_number, OLD.status
      USING ERRCODE = '22023';
  END IF;

  -- 3. Interdiction de changer l'identifiant, le numéro de commande ou le demandeur
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.order_number IS DISTINCT FROM OLD.order_number OR NEW.requester_id IS DISTINCT FROM OLD.requester_id THEN
    RAISE EXCEPTION 'Modification interdite des champs structurels de la commande (id, order_number, requester_id).'
      USING ERRCODE = '42501';
  END IF;

  -- Vérifier si l'appelant est approbateur (rôle admin/manager, permission perm_order_approve, chef de département ou chef de chantier)
  IF v_crole IN (0, 1, 2, 6, 7, 8) OR public.current_user_has_perm('perm_order_approve') OR public.current_user_has_perm('perm_orders_manage') THEN
    v_is_approver := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.departments d
      WHERE (d.name::text = OLD.requester_department::text OR d.id::text = OLD.requester_department::text)
        AND (
          d.manager_id::text = v_cid::text 
          OR (d.deputy_manager_ids IS NOT NULL AND v_cid::text = ANY(ARRAY(SELECT unnest(d.deputy_manager_ids)::text)))
        )
    ) OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE (UPPER(p.project_number) = UPPER(OLD.site_number) OR UPPER(OLD.site_number) LIKE '%' || UPPER(p.project_number) || '%')
        AND (
          p.manager_id::text = v_cid::text
          OR (p.deputy_manager_ids IS NOT NULL AND v_cid::text = ANY(ARRAY(SELECT unnest(p.deputy_manager_ids)::text)))
        )
    ) INTO v_is_approver;
  END IF;

  v_is_prep := (
    v_crole IN (0, 1, 2, 6, 7)
    OR public.current_user_has_perm('perm_menu_order_prep')
    OR public.current_user_has_perm('perm_order_assign')
    OR public.current_user_has_perm('perm_order_mark_ready')
    OR public.current_user_has_perm('perm_orders_manage')
  );

  -- 4. Contrôle des transitions de statut (transition_order_status)
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Interdiction d'auto-approbation (sauf rôle 0)
    IF OLD.status = 'WAITING_APPROVAL' AND NEW.status IN ('PENDING', 'REJECTED') THEN
      IF OLD.requester_id::text = v_cid::text AND v_crole != 0 THEN
        RAISE EXCEPTION 'Interdiction d''auto-approbation : Vous ne pouvez pas valider votre propre commande.'
          USING ERRCODE = '42501';
      END IF;
      IF NOT (v_crole = 0 OR v_is_approver OR v_is_prep) THEN
        RAISE EXCEPTION 'Droits insuffisants pour approuver ou rejeter les commandes de ce département.'
          USING ERRCODE = '42501';
      END IF;

    ELSIF OLD.status = 'PENDING' AND NEW.status = 'PREPARING' THEN
      IF NOT v_is_prep THEN
        RAISE EXCEPTION 'Droits insuffisants : Seul un préparateur (perm_menu_order_prep) peut démarrer la préparation.'
          USING ERRCODE = '42501';
      END IF;

    ELSIF OLD.status = 'PREPARING' AND NEW.status = 'READY' THEN
      IF NOT v_is_prep THEN
        RAISE EXCEPTION 'Droits insuffisants : Seul un préparateur peut marquer une commande prête.'
          USING ERRCODE = '42501';
      END IF;

    ELSIF OLD.status = 'READY' AND NEW.status = 'COLLECTED' THEN
      IF NOT (
        v_crole = 0
        OR v_is_prep
        OR OLD.requester_id::text = v_cid::text
        OR (OLD.pickup_delegate_id IS NOT NULL AND OLD.pickup_delegate_id::text = v_cid::text)
      ) THEN
        RAISE EXCEPTION 'Droits insuffisants pour confirmer le retrait de cette commande.'
          USING ERRCODE = '42501';
      END IF;

    ELSIF NEW.status = 'CANCELLED' THEN
      IF OLD.requester_id::text = v_cid::text THEN
        IF OLD.status NOT IN ('WAITING_APPROVAL', 'PENDING') AND v_crole != 0 THEN
          RAISE EXCEPTION 'Le demandeur ne peut annuler sa commande qu''avant le début de la préparation.'
            USING ERRCODE = '42501';
        END IF;
      ELSE
        IF NOT (v_crole = 0 OR v_is_approver OR v_is_prep) THEN
          RAISE EXCEPTION 'Droits insuffisants pour annuler cette commande.'
            USING ERRCODE = '42501';
        END IF;
      END IF;

    ELSE
      RAISE EXCEPTION 'Transition de statut non autorisée de % vers %.', OLD.status, NEW.status
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 5. Limiter les colonnes modifiables par un simple demandeur
  IF OLD.requester_id::text = v_cid::text AND v_crole != 0 AND NOT v_is_prep AND NOT v_is_approver THEN
    IF OLD.status NOT IN ('WAITING_APPROVAL', 'PENDING') AND NEW.status = OLD.status THEN
      RAISE EXCEPTION 'La commande est en cours de traitement et ne peut plus être modifiée par le demandeur.'
        USING ERRCODE = '42501';
    END IF;

    -- Le simple demandeur ne peut modifier QUE : items, notes, site_number, site_name, depot_name, pickup_delegate_id, pickup_delegate_name, status (si annulation)
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.rejected_by IS DISTINCT FROM OLD.rejected_by
       OR NEW.rejected_at IS DISTINCT FROM OLD.rejected_at
       OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
       OR NEW.preparer_id IS DISTINCT FROM OLD.preparer_id
       OR NEW.preparer_name IS DISTINCT FROM OLD.preparer_name
       OR NEW.pickup_zone IS DISTINCT FROM OLD.pickup_zone
       OR NEW.ready_qr_code IS DISTINCT FROM OLD.ready_qr_code THEN
      RAISE EXCEPTION 'Champs de préparation ou de validation non modifiables par le demandeur.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_material_orders_update ON public.material_orders;
CREATE TRIGGER trg_check_material_orders_update
  BEFORE UPDATE ON public.material_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.check_material_orders_update();

-- Note : AUCUNE politique FOR DELETE sur material_orders.
-- La suppression physique est interdite ; les annulations se font par mise à jour du statut vers 'CANCELLED'.

-- -------------------------------------------------------------------------
-- 9. AUTRES TABLES SYSTÈME : public.roles, departments, projects, sub_categories, depots, stock_levels
-- -------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'roles') THEN
    ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Allow anon roles" ON public.roles;
    DROP POLICY IF EXISTS "Authenticated read roles" ON public.roles;
    CREATE POLICY "Authenticated read roles" ON public.roles FOR SELECT TO authenticated
      USING (public.current_user_id() IS NOT NULL);
    DROP POLICY IF EXISTS "Admin write roles" ON public.roles;
    CREATE POLICY "Admin write roles" ON public.roles FOR ALL TO authenticated
      USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_roles'))
      WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_roles'));
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'departments') THEN
    ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Allow anon departments" ON public.departments;
    DROP POLICY IF EXISTS "Authenticated read departments" ON public.departments;
    CREATE POLICY "Authenticated read departments" ON public.departments FOR SELECT TO authenticated
      USING (public.current_user_id() IS NOT NULL);
    DROP POLICY IF EXISTS "Admin write departments" ON public.departments;
    CREATE POLICY "Admin write departments" ON public.departments FOR ALL TO authenticated
      USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_depproj_menu') OR public.current_user_has_perm('perm_dep_edit'))
      WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_depproj_menu') OR public.current_user_has_perm('perm_dep_edit'));
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'projects') THEN
    ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Allow anon projects" ON public.projects;
    DROP POLICY IF EXISTS "Authenticated read projects" ON public.projects;
    CREATE POLICY "Authenticated read projects" ON public.projects FOR SELECT TO authenticated
      USING (public.current_user_id() IS NOT NULL);
    DROP POLICY IF EXISTS "Admin write projects" ON public.projects;
    CREATE POLICY "Admin write projects" ON public.projects FOR ALL TO authenticated
      USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_depproj_menu') OR public.current_user_has_perm('perm_proj_edit'))
      WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_depproj_menu') OR public.current_user_has_perm('perm_proj_edit'));
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sub_categories') THEN
    ALTER TABLE public.sub_categories ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Allow anon sub_categories" ON public.sub_categories;
    DROP POLICY IF EXISTS "Authenticated read sub_categories" ON public.sub_categories;
    CREATE POLICY "Authenticated read sub_categories" ON public.sub_categories FOR SELECT TO authenticated
      USING (public.current_user_id() IS NOT NULL);
    DROP POLICY IF EXISTS "Admin write sub_categories" ON public.sub_categories;
    CREATE POLICY "Admin write sub_categories" ON public.sub_categories FOR ALL TO authenticated
      USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_categories') OR public.current_user_has_perm('perm_prod_edit'))
      WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_categories') OR public.current_user_has_perm('perm_prod_edit'));
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'depots') THEN
    ALTER TABLE public.depots ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Allow anon depots" ON public.depots;
    DROP POLICY IF EXISTS "Authenticated read depots" ON public.depots;
    CREATE POLICY "Authenticated read depots" ON public.depots FOR SELECT TO authenticated
      USING (public.current_user_id() IS NOT NULL);
    DROP POLICY IF EXISTS "Admin write depots" ON public.depots;
    CREATE POLICY "Admin write depots" ON public.depots FOR ALL TO authenticated
      USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_depots') OR public.current_user_has_perm('perm_depot_create'))
      WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_depots') OR public.current_user_has_perm('perm_depot_create'));
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stock_levels') THEN
    ALTER TABLE public.stock_levels ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Allow anon stock_levels" ON public.stock_levels;
    DROP POLICY IF EXISTS "Authenticated read stock_levels" ON public.stock_levels;
    DROP POLICY IF EXISTS "Admin write stock_levels" ON public.stock_levels;
    CREATE POLICY "Authenticated read stock_levels" ON public.stock_levels
      FOR SELECT TO authenticated
      USING (
        public.is_administrator()
        OR public.current_user_has_perm('perm_mov_view_all')
        OR EXISTS (
          SELECT 1 FROM public.depots d
          WHERE d.name = stock_levels.depot_name
            AND (
              d.type = 'FIXED'
              OR d.type IS NULL
              OR d.manager_id::text = public.current_user_id()
              OR (
                SELECT allowed_depots FROM public.users WHERE id::text = public.current_user_id()
              ) @> ARRAY[d.name]
              OR '*'::text = ANY(COALESCE((SELECT allowed_depots FROM public.users WHERE id::text = public.current_user_id()), '{}'::text[]))
              OR (
                d.type = 'CONTAINER' AND d.project_number IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.projects p
                  WHERE p.project_number = d.project_number
                    AND (p.manager_id::text = public.current_user_id() OR public.current_user_id() = ANY(ARRAY(SELECT unnest(p.deputy_manager_ids)::text)))
                )
              )
            )
        )
      );
    CREATE POLICY "Admin write stock_levels" ON public.stock_levels
      FOR ALL TO authenticated
      USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_menu_inventory_audit') OR public.current_user_has_perm('perm_prod_edit'))
      WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_menu_inventory_audit') OR public.current_user_has_perm('perm_prod_edit'));
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 10. DURCISSEMENT TABLE : public.audit_logs
-- (Lecture réservée à perm_menu_inventory_audit, perm_view_all_login_logs ou rôle 0.
-- Insertion seulement avec user_id = public.current_user_id() ou par RPCs)
-- -------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs') THEN
    ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Allow anon audit_logs" ON public.audit_logs;
    DROP POLICY IF EXISTS "Authenticated read audit_logs" ON public.audit_logs;
    DROP POLICY IF EXISTS "Authenticated insert audit_logs" ON public.audit_logs;

    CREATE POLICY "Authenticated read audit_logs"
      ON public.audit_logs
      FOR SELECT
      TO authenticated
      USING (
        public.current_user_role() = 0
        OR public.current_user_has_perm('perm_menu_inventory_audit')
        OR public.current_user_has_perm('perm_view_all_login_logs')
      );

    CREATE POLICY "Authenticated insert audit_logs"
      ON public.audit_logs
      FOR INSERT
      TO authenticated
      WITH CHECK (
        user_id::text = public.current_user_id()
        OR user_id::text = auth.uid()::text
        OR auth.uid() IS NULL
      );
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 11. LECTURE SÉCURISÉE DU SECRET E-MAIL DEPUIS SUPABASE VAULT (Point 2 v24)
-- Fonction SQL SECURITY DEFINER exécutable UNIQUEMENT par service_role
-- (utilisée par l'Edge Function send-report-email sans secret manuel).
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_email_secret()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_api_key TEXT := NULL;
  v_smtp_pass TEXT := NULL;
  v_sender_email TEXT := NULL;
  v_sender_name TEXT := NULL;
BEGIN
  -- 1. Lecture prioritaire depuis Supabase Vault (vault.decrypted_secrets)
  IF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'vault' AND table_name = 'decrypted_secrets'
  ) THEN
    BEGIN
      EXECUTE $q$
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name IN ('BREVO_API_KEY', 'SENDINBLUE_API_KEY', 'tot_brevo_api_key', 'email_api_key')
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1
      $q$ INTO v_api_key;
    EXCEPTION WHEN OTHERS THEN
      v_api_key := NULL;
    END;

    BEGIN
      EXECUTE $q$
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name IN ('SMTP_PASS', 'SMTP_PASSWORD', 'tot_smtp_pass')
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1
      $q$ INTO v_smtp_pass;
    EXCEPTION WHEN OTHERS THEN
      v_smtp_pass := NULL;
    END;
  END IF;

  -- 2. Paramètres expéditeur (et repli éventuel) dans public.app_settings
  BEGIN
    SELECT value INTO v_sender_email
    FROM public.app_settings
    WHERE key IN ('smtp_from', 'brevo_sender_email')
    LIMIT 1;

    SELECT value INTO v_sender_name
    FROM public.app_settings
    WHERE key IN ('smtp_from_name', 'company_name')
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'configured', (COALESCE(NULLIF(TRIM(v_api_key), ''), NULLIF(TRIM(v_smtp_pass), '')) IS NOT NULL),
    'brevo_api_key', NULLIF(TRIM(v_api_key), ''),
    'smtp_pass', NULLIF(TRIM(v_smtp_pass), ''),
    'sender_email', NULLIF(TRIM(v_sender_email), ''),
    'sender_name', NULLIF(TRIM(v_sender_name), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_email_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_email_secret() TO service_role;
