-- =========================================================================
-- TOT STOCK - SCRIPT 02 : RLS HARDENING (02_rls_hardening.sql)
-- Description : Durcissement strict des règles Row Level Security (RLS) sur les tables core_* et stk_*,
--   blocage total de 'anon', lecture seule de core_license_config, plan_limits(plan), get_email_secret(),
--   interdiction des écritures directes sur core_users et protection de stk_products.quantity.
-- Dépendances : 00_complete_tot_stock_schema.sql, 09_core_prefixes.sql, 01_auth_link.sql
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
    RAISE EXCEPTION 'Prérequis manquant (02_rls_hardening.sql) : La table public.core_users est absente. Exécutez d''abord 09_core_prefixes.sql ou 00_complete_tot_stock_schema.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'core_users' AND column_name = 'auth_user_id'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (02_rls_hardening.sql) : La colonne public.core_users.auth_user_id est absente. Exécutez d''abord 01_auth_link.sql.';
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
-- 0.0 Tables structurelles de base alignées sur le schéma v2.0.0 (core_* et stk_*)
-- Tous les identifiants utilisateur sont en TEXT.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.core_license_config (
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

DO $$
DECLARE
  v_id_type TEXT;
  v_id_identity TEXT;
BEGIN
  SELECT data_type, is_identity INTO v_id_type, v_id_identity
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'core_license_config' AND column_name = 'id';

  IF v_id_type IS NOT NULL AND v_id_type <> 'text' THEN
    DROP VIEW IF EXISTS public.license_config;
    ALTER TABLE public.core_license_config DROP CONSTRAINT IF EXISTS license_config_id_check;
    ALTER TABLE public.core_license_config DROP CONSTRAINT IF EXISTS core_license_config_id_check;
    IF v_id_identity = 'YES' THEN
      ALTER TABLE public.core_license_config ALTER COLUMN id DROP IDENTITY;
    END IF;
    ALTER TABLE public.core_license_config ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE public.core_license_config ALTER COLUMN id TYPE TEXT USING (
      CASE WHEN id::text = '1' THEN 'active_license' ELSE id::text END
    );
    ALTER TABLE public.core_license_config ALTER COLUMN id SET DEFAULT 'active_license';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_core_license_config_id ON public.core_license_config (id);

ALTER TABLE public.core_license_config
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
    WHERE table_schema = 'public' AND table_name = 'core_license_config' AND column_name = 'plan'
  ) THEN
    EXECUTE 'UPDATE public.core_license_config SET plan_type = COALESCE(NULLIF(plan_type, ''free''), plan, ''free'') WHERE plan IS NOT NULL';
  END IF;
END $$;

INSERT INTO public.core_license_config (id, license_key, plan_type, modules, max_depots)
VALUES ('active_license', 'TOT-STOCK-FREE-COMMUNITY', 'free', ARRAY['stock']::TEXT[], 1)
ON CONFLICT (id) DO NOTHING;

-- 1. Fonction unique des plafonds techniques par formule : plan_limits(plan)
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

CREATE TABLE IF NOT EXISTS public.core_roles (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.core_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigram TEXT,
  email TEXT,
  department TEXT,
  pin TEXT DEFAULT '',
  pin_hash TEXT DEFAULT '',
  role_id BIGINT REFERENCES public.core_roles(id) DEFAULT 4,
  is_blocked BOOLEAN DEFAULT false,
  allowed_depots TEXT[] DEFAULT '{}'::TEXT[],
  must_change_pin BOOLEAN DEFAULT false,
  is_preparer BOOLEAN DEFAULT false,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.core_app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.core_departments (
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

CREATE TABLE IF NOT EXISTS public.core_projects (
  id BIGSERIAL PRIMARY KEY,
  department_id BIGINT REFERENCES public.core_departments(id),
  project_number TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL,
  manager_id TEXT,
  deputy_manager_ids TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stk_sub_categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stk_depots (
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

CREATE TABLE IF NOT EXISTS public.stk_products (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  manufacturer_ref TEXT,
  barcode TEXT,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  sub_category_id BIGINT REFERENCES public.stk_sub_categories(id),
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

CREATE TABLE IF NOT EXISTS public.stk_movements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id TEXT NOT NULL REFERENCES public.stk_products(id) ON DELETE CASCADE,
  product_ref TEXT,
  user_id TEXT,
  user_name TEXT,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('IN', 'OUT')),
  quantity_changed NUMERIC(10,2) NOT NULL,
  reason TEXT,
  site_number TEXT,
  department_name TEXT,
  depot_name TEXT,
  dest_depot_name TEXT,
  total_cost NUMERIC(10,2) DEFAULT 0,
  order_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stk_material_orders (
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

CREATE TABLE IF NOT EXISTS public.core_audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  app TEXT DEFAULT 'stock',
  timestamp TIMESTAMPTZ DEFAULT now(),
  user_id TEXT,
  user_name TEXT,
  action TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  severity TEXT DEFAULT 'INFO',
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 0.1 Table stk_stock_levels
CREATE TABLE IF NOT EXISTS public.stk_stock_levels (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id TEXT NOT NULL,
  depot_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  min_stock NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- [BEGIN AUTO_GENERATED_ADD_COLUMNS]
-- Alignement automatique des colonnes manquantes sur les tables déjà existantes (généré par scripts/build-sql.mjs)
ALTER TABLE IF EXISTS public.core_license_config ADD COLUMN IF NOT EXISTS license_key TEXT;
ALTER TABLE IF EXISTS public.core_license_config ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'free';
ALTER TABLE IF EXISTS public.core_license_config ADD COLUMN IF NOT EXISTS modules TEXT[] DEFAULT ARRAY['stock']::TEXT[];
ALTER TABLE IF EXISTS public.core_license_config ADD COLUMN IF NOT EXISTS max_depots INT DEFAULT 1;
ALTER TABLE IF EXISTS public.core_license_config ADD COLUMN IF NOT EXISTS organization_name TEXT;
ALTER TABLE IF EXISTS public.core_license_config ADD COLUMN IF NOT EXISTS signed_token TEXT;
ALTER TABLE IF EXISTS public.core_license_config ADD COLUMN IF NOT EXISTS offline_until TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.core_license_config ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_roles ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE IF EXISTS public.core_roles ADD COLUMN IF NOT EXISTS permissions TEXT[] DEFAULT '{}';
ALTER TABLE IF EXISTS public.core_roles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_users ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE IF EXISTS public.core_users ADD COLUMN IF NOT EXISTS trigram TEXT;
ALTER TABLE IF EXISTS public.core_users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE IF EXISTS public.core_users ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE IF EXISTS public.core_users ADD COLUMN IF NOT EXISTS pin TEXT DEFAULT '';
ALTER TABLE IF EXISTS public.core_users ADD COLUMN IF NOT EXISTS pin_hash TEXT DEFAULT '';
ALTER TABLE IF EXISTS public.core_users ADD COLUMN IF NOT EXISTS role_id BIGINT DEFAULT 4;
ALTER TABLE IF EXISTS public.core_users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false;
ALTER TABLE IF EXISTS public.core_users ADD COLUMN IF NOT EXISTS allowed_depots TEXT[] DEFAULT '{}'::TEXT[];
ALTER TABLE IF EXISTS public.core_users ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN DEFAULT false;
ALTER TABLE IF EXISTS public.core_users ADD COLUMN IF NOT EXISTS is_preparer BOOLEAN DEFAULT false;
ALTER TABLE IF EXISTS public.core_users ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE IF EXISTS public.core_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_app_settings ADD COLUMN IF NOT EXISTS key TEXT;
ALTER TABLE IF EXISTS public.core_app_settings ADD COLUMN IF NOT EXISTS value TEXT;
ALTER TABLE IF EXISTS public.core_app_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_app_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_departments ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE IF EXISTS public.core_departments ADD COLUMN IF NOT EXISTS manager_id TEXT;
ALTER TABLE IF EXISTS public.core_departments ADD COLUMN IF NOT EXISTS deputy_manager_ids TEXT[] DEFAULT '{}';
ALTER TABLE IF EXISTS public.core_departments ADD COLUMN IF NOT EXISTS allow_global_kpis BOOLEAN DEFAULT false;
ALTER TABLE IF EXISTS public.core_departments ADD COLUMN IF NOT EXISTS is_preparer_dept BOOLEAN DEFAULT false;
ALTER TABLE IF EXISTS public.core_departments ADD COLUMN IF NOT EXISTS require_order_approval BOOLEAN DEFAULT false;
ALTER TABLE IF EXISTS public.core_departments ADD COLUMN IF NOT EXISTS order_approval_threshold NUMERIC(10,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.core_departments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_projects ADD COLUMN IF NOT EXISTS department_id BIGINT;
ALTER TABLE IF EXISTS public.core_projects ADD COLUMN IF NOT EXISTS project_number TEXT;
ALTER TABLE IF EXISTS public.core_projects ADD COLUMN IF NOT EXISTS project_name TEXT;
ALTER TABLE IF EXISTS public.core_projects ADD COLUMN IF NOT EXISTS manager_id TEXT;
ALTER TABLE IF EXISTS public.core_projects ADD COLUMN IF NOT EXISTS deputy_manager_ids TEXT[] DEFAULT '{}';
ALTER TABLE IF EXISTS public.core_projects ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_sub_categories ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE IF EXISTS public.stk_sub_categories ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE IF EXISTS public.stk_sub_categories ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'FIXED';
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS vehicle_reg TEXT;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS manager_id TEXT;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS container_ref TEXT;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS project_number TEXT;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS pickup_zones TEXT[] DEFAULT '{}';
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS manufacturer_ref TEXT;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS sub_category_id BIGINT;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS tags TEXT;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS supplier_1_name TEXT;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS ref_supplier_1 TEXT;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS supplier_2_name TEXT;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS ref_supplier_2 TEXT;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS store_name TEXT;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS room_name TEXT;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS shelf_name TEXT;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS quantity NUMERIC(10,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS min_stock_alert NUMERIC(10,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_movements ADD COLUMN IF NOT EXISTS product_id TEXT;
ALTER TABLE IF EXISTS public.stk_movements ADD COLUMN IF NOT EXISTS product_ref TEXT;
ALTER TABLE IF EXISTS public.stk_movements ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE IF EXISTS public.stk_movements ADD COLUMN IF NOT EXISTS user_name TEXT;
ALTER TABLE IF EXISTS public.stk_movements ADD COLUMN IF NOT EXISTS movement_type TEXT;
ALTER TABLE IF EXISTS public.stk_movements ADD COLUMN IF NOT EXISTS quantity_changed NUMERIC(10,2);
ALTER TABLE IF EXISTS public.stk_movements ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE IF EXISTS public.stk_movements ADD COLUMN IF NOT EXISTS site_number TEXT;
ALTER TABLE IF EXISTS public.stk_movements ADD COLUMN IF NOT EXISTS department_name TEXT;
ALTER TABLE IF EXISTS public.stk_movements ADD COLUMN IF NOT EXISTS depot_name TEXT;
ALTER TABLE IF EXISTS public.stk_movements ADD COLUMN IF NOT EXISTS dest_depot_name TEXT;
ALTER TABLE IF EXISTS public.stk_movements ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_movements ADD COLUMN IF NOT EXISTS order_number TEXT;
ALTER TABLE IF EXISTS public.stk_movements ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS order_number TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS site_number TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS site_name TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS depot_name TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS requester_id TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS requester_name TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS requester_department TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING';
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS rejected_by TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS pickup_zone TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS ready_qr_code TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS signature_data TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS proof_photo_url TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT false;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS preparer_id TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS preparer_name TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS pickup_delegate_id TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS collected_by TEXT;
ALTER TABLE IF EXISTS public.stk_material_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS app TEXT DEFAULT 'stock';
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS user_name TEXT;
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS action TEXT;
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'INFO';
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_stock_levels ADD COLUMN IF NOT EXISTS product_id TEXT;
ALTER TABLE IF EXISTS public.stk_stock_levels ADD COLUMN IF NOT EXISTS depot_name TEXT;
ALTER TABLE IF EXISTS public.stk_stock_levels ADD COLUMN IF NOT EXISTS quantity NUMERIC DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_stock_levels ADD COLUMN IF NOT EXISTS min_stock NUMERIC DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_stock_levels ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_stock_levels ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_company_settings ADD COLUMN IF NOT EXISTS key TEXT;
ALTER TABLE IF EXISTS public.core_company_settings ADD COLUMN IF NOT EXISTS value TEXT;
ALTER TABLE IF EXISTS public.core_company_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_login_logs ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE IF EXISTS public.core_login_logs ADD COLUMN IF NOT EXISTS user_name TEXT;
ALTER TABLE IF EXISTS public.core_login_logs ADD COLUMN IF NOT EXISTS action TEXT DEFAULT 'LOGIN_SUCCESS';
ALTER TABLE IF EXISTS public.core_login_logs ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE IF EXISTS public.core_login_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE IF EXISTS public.core_login_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'SYSTEM';
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'SYSTEM';
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS user_trigram TEXT;
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS product_id TEXT;
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS product_ref TEXT;
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS quantity_changed INT;
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS site_number TEXT;
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS depot_name TEXT;
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS title TEXT DEFAULT '';
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS badge_text TEXT;
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS public.core_processed_operations ADD COLUMN IF NOT EXISTS operation_id UUID;
ALTER TABLE IF EXISTS public.core_processed_operations ADD COLUMN IF NOT EXISTS app TEXT DEFAULT 'stock';
ALTER TABLE IF EXISTS public.core_processed_operations ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE IF EXISTS public.core_processed_operations ADD COLUMN IF NOT EXISTS entity TEXT;
ALTER TABLE IF EXISTS public.core_processed_operations ADD COLUMN IF NOT EXISTS action TEXT;
ALTER TABLE IF EXISTS public.core_processed_operations ADD COLUMN IF NOT EXISTS action_type TEXT;
ALTER TABLE IF EXISTS public.core_processed_operations ADD COLUMN IF NOT EXISTS result JSONB;
ALTER TABLE IF EXISTS public.core_processed_operations ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_processed_operations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS company_id TEXT;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS manager TEXT;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS vehicle_type TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS license_plate TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS manager_name TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS binome_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS binome_names JSONB DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS department_id TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS public.stk_depots ADD COLUMN IF NOT EXISTS department_name TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS public.stk_stock_levels ADD COLUMN IF NOT EXISTS min_alert NUMERIC DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_stock_levels ADD COLUMN IF NOT EXISTS rack_location TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS depot_name TEXT;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS auditor_id TEXT;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS auditor_name TEXT;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS validator_id TEXT;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS validator_name TEXT;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'COMPLETED';
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS items_counted INT DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS items_with_diff INT DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS total_diff_cost NUMERIC(12,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS audit_notes TEXT;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS total_references INT DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS counted_references INT DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS discrepancies_count INT DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS positive_diff_value NUMERIC(12,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS negative_diff_value NUMERIC(12,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS net_diff_value NUMERIC(12,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.stk_inventory_audits ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_inventory_audit_items ADD COLUMN IF NOT EXISTS audit_id TEXT;
ALTER TABLE IF EXISTS public.stk_inventory_audit_items ADD COLUMN IF NOT EXISTS product_id TEXT;
ALTER TABLE IF EXISTS public.stk_inventory_audit_items ADD COLUMN IF NOT EXISTS product_ref TEXT;
ALTER TABLE IF EXISTS public.stk_inventory_audit_items ADD COLUMN IF NOT EXISTS product_name TEXT;
ALTER TABLE IF EXISTS public.stk_inventory_audit_items ADD COLUMN IF NOT EXISTS theoretical_qty NUMERIC(12,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_inventory_audit_items ADD COLUMN IF NOT EXISTS physical_count NUMERIC(12,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_inventory_audit_items ADD COLUMN IF NOT EXISTS difference NUMERIC(12,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_inventory_audit_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_inventory_audit_items ADD COLUMN IF NOT EXISTS diff_cost NUMERIC(12,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_inventory_audit_items ADD COLUMN IF NOT EXISTS scanned_barcode TEXT;
ALTER TABLE IF EXISTS public.stk_inventory_audit_items ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_app_compat ADD COLUMN IF NOT EXISTS schema_version TEXT DEFAULT '2.10.0';
ALTER TABLE IF EXISTS public.core_app_compat ADD COLUMN IF NOT EXISTS min_schema_version TEXT DEFAULT '1.0.0';
ALTER TABLE IF EXISTS public.core_app_compat ADD COLUMN IF NOT EXISTS min_app_version TEXT DEFAULT '1.0.0';
ALTER TABLE IF EXISTS public.core_app_compat ADD COLUMN IF NOT EXISTS latest_version TEXT;
ALTER TABLE IF EXISTS public.core_app_compat ADD COLUMN IF NOT EXISTS update_url TEXT;
ALTER TABLE IF EXISTS public.core_app_compat ADD COLUMN IF NOT EXISTS maintenance BOOLEAN DEFAULT false;
ALTER TABLE IF EXISTS public.core_app_compat ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE IF EXISTS public.core_app_compat ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_print_stations ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE IF EXISTS public.stk_print_stations ADD COLUMN IF NOT EXISTS depot_name TEXT;
ALTER TABLE IF EXISTS public.stk_print_stations ADD COLUMN IF NOT EXISTS owner_user_id TEXT;
ALTER TABLE IF EXISTS public.stk_print_stations ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_print_stations ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE IF EXISTS public.stk_print_stations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_print_jobs ADD COLUMN IF NOT EXISTS station_id UUID;
ALTER TABLE IF EXISTS public.stk_print_jobs ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE IF EXISTS public.stk_print_jobs ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE IF EXISTS public.stk_print_jobs ADD COLUMN IF NOT EXISTS format TEXT;
ALTER TABLE IF EXISTS public.stk_print_jobs ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE IF EXISTS public.stk_print_jobs ADD COLUMN IF NOT EXISTS copies INT DEFAULT 1;
ALTER TABLE IF EXISTS public.stk_print_jobs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING';
ALTER TABLE IF EXISTS public.stk_print_jobs ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE IF EXISTS public.stk_print_jobs ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
ALTER TABLE IF EXISTS public.stk_print_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_print_jobs ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.stk_print_jobs ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT (now() + interval '24 hours');
ALTER TABLE IF EXISTS public.stk_order_preparations_log ADD COLUMN IF NOT EXISTS order_id TEXT;
ALTER TABLE IF EXISTS public.stk_order_preparations_log ADD COLUMN IF NOT EXISTS order_number TEXT;
ALTER TABLE IF EXISTS public.stk_order_preparations_log ADD COLUMN IF NOT EXISTS product_id TEXT;
ALTER TABLE IF EXISTS public.stk_order_preparations_log ADD COLUMN IF NOT EXISTS product_ref TEXT;
ALTER TABLE IF EXISTS public.stk_order_preparations_log ADD COLUMN IF NOT EXISTS preparer_id TEXT;
ALTER TABLE IF EXISTS public.stk_order_preparations_log ADD COLUMN IF NOT EXISTS preparer_name TEXT;
ALTER TABLE IF EXISTS public.stk_order_preparations_log ADD COLUMN IF NOT EXISTS picked_quantity NUMERIC(10,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_order_preparations_log ADD COLUMN IF NOT EXISTS scanned_barcode TEXT;
ALTER TABLE IF EXISTS public.stk_order_preparations_log ADD COLUMN IF NOT EXISTS pickup_zone TEXT;
ALTER TABLE IF EXISTS public.stk_order_preparations_log ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_order_preparations_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_categories ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE IF EXISTS public.stk_categories ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE IF EXISTS public.stk_categories ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_categories ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_material_order_items ADD COLUMN IF NOT EXISTS order_id TEXT;
ALTER TABLE IF EXISTS public.stk_material_order_items ADD COLUMN IF NOT EXISTS product_id TEXT;
ALTER TABLE IF EXISTS public.stk_material_order_items ADD COLUMN IF NOT EXISTS product_ref TEXT;
ALTER TABLE IF EXISTS public.stk_material_order_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE IF EXISTS public.stk_material_order_items ADD COLUMN IF NOT EXISTS quantity NUMERIC(10,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_material_order_items ADD COLUMN IF NOT EXISTS picked_quantity NUMERIC(10,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_material_order_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_material_order_items ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE IF EXISTS public.stk_material_order_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_material_order_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS app TEXT DEFAULT 'stock';
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS entity_id TEXT;
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS subject_user_id TEXT;
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS bucket TEXT DEFAULT 'tot-files';
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT;
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS doc_category TEXT;
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS valid_from DATE;
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS valid_until DATE;
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS replaces_file_id UUID;
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS uploaded_by TEXT;
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE IF EXISTS public.core_files ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS public.core_user_preferences ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE IF EXISTS public.core_user_preferences ADD COLUMN IF NOT EXISTS prefs JSONB DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS public.core_user_preferences ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_mail_accounts ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE IF EXISTS public.core_mail_accounts ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE IF EXISTS public.core_mail_accounts ADD COLUMN IF NOT EXISTS preset TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS public.core_mail_accounts ADD COLUMN IF NOT EXISTS smtp_host TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS public.core_mail_accounts ADD COLUMN IF NOT EXISTS smtp_port INT DEFAULT NULL;
ALTER TABLE IF EXISTS public.core_mail_accounts ADD COLUMN IF NOT EXISTS smtp_encryption TEXT DEFAULT 'starttls';
ALTER TABLE IF EXISTS public.core_mail_accounts ADD COLUMN IF NOT EXISTS smtp_username TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS public.core_mail_accounts ADD COLUMN IF NOT EXISTS extra JSONB DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS public.core_mail_accounts ADD COLUMN IF NOT EXISTS secret_name TEXT DEFAULT '';
ALTER TABLE IF EXISTS public.core_mail_accounts ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE IF EXISTS public.core_mail_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_mail_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_mail_senders ADD COLUMN IF NOT EXISTS app_code TEXT;
ALTER TABLE IF EXISTS public.core_mail_senders ADD COLUMN IF NOT EXISTS account_id UUID;
ALTER TABLE IF EXISTS public.core_mail_senders ADD COLUMN IF NOT EXISTS from_name TEXT;
ALTER TABLE IF EXISTS public.core_mail_senders ADD COLUMN IF NOT EXISTS from_email TEXT;
ALTER TABLE IF EXISTS public.core_mail_senders ADD COLUMN IF NOT EXISTS reply_to TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS public.core_mail_senders ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE IF EXISTS public.core_mail_senders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_mail_log ADD COLUMN IF NOT EXISTS app_code TEXT DEFAULT 'stk';
ALTER TABLE IF EXISTS public.core_mail_log ADD COLUMN IF NOT EXISTS account_id UUID;
ALTER TABLE IF EXISTS public.core_mail_log ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS public.core_mail_log ADD COLUMN IF NOT EXISTS sender_email TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS public.core_mail_log ADD COLUMN IF NOT EXISTS recipient_masked TEXT;
ALTER TABLE IF EXISTS public.core_mail_log ADD COLUMN IF NOT EXISTS recipient_count INT DEFAULT 1;
ALTER TABLE IF EXISTS public.core_mail_log ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE IF EXISTS public.core_mail_log ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE IF EXISTS public.core_mail_log ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'transactional';
ALTER TABLE IF EXISTS public.core_mail_log ADD COLUMN IF NOT EXISTS message_id TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS public.core_mail_log ADD COLUMN IF NOT EXISTS error_message TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS public.core_mail_log ADD COLUMN IF NOT EXISTS user_id TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS public.core_mail_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS table_name TEXT;
ALTER TABLE IF EXISTS public.core_audit_logs ADD COLUMN IF NOT EXISTS record_id TEXT;
ALTER TABLE IF EXISTS public.core_login_logs ADD COLUMN IF NOT EXISTS app TEXT DEFAULT 'stock';
ALTER TABLE IF EXISTS public.core_login_logs ADD COLUMN IF NOT EXISTS user_trigram TEXT;
ALTER TABLE IF EXISTS public.core_login_logs ADD COLUMN IF NOT EXISTS identifier TEXT;
ALTER TABLE IF EXISTS public.core_login_logs ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE IF EXISTS public.core_login_logs ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS public.core_login_logs ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_depot_holders ADD COLUMN IF NOT EXISTS depot_id TEXT;
ALTER TABLE IF EXISTS public.stk_depot_holders ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE IF EXISTS public.stk_depot_holders ADD COLUMN IF NOT EXISTS can_send BOOLEAN DEFAULT true;
ALTER TABLE IF EXISTS public.stk_depot_holders ADD COLUMN IF NOT EXISTS can_receive BOOLEAN DEFAULT true;
ALTER TABLE IF EXISTS public.stk_depot_holders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_depot_holders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS transfer_number TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS batch_id UUID;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS source_depot_id TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS source_depot TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS dest_depot_id TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS dest_depot TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'IN_TRANSIT';
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS total_pieces NUMERIC DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS total_cost NUMERIC DEFAULT 0;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS sender_id TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS sender_trigram TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS receiver_id TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS receiver_name TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS receiver_note TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS sender_confirmed_by TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS sender_confirmed_by_name TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS sender_confirmed_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS sender_comment TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS resolved_by TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS resolved_by_name TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS resolution_action TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS resolution_note TEXT;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS comments_history JSONB DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.stk_transfers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.core_password_resets ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE IF EXISTS public.core_password_resets ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE IF EXISTS public.core_password_resets ADD COLUMN IF NOT EXISTS code_hash TEXT;
ALTER TABLE IF EXISTS public.core_password_resets ADD COLUMN IF NOT EXISTS code_salt TEXT DEFAULT '';
ALTER TABLE IF EXISTS public.core_password_resets ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.core_password_resets ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0;
ALTER TABLE IF EXISTS public.core_password_resets ADD COLUMN IF NOT EXISTS max_attempts INT DEFAULT 5;
ALTER TABLE IF EXISTS public.core_password_resets ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.core_password_resets ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.core_password_resets ADD COLUMN IF NOT EXISTS request_ip TEXT;
ALTER TABLE IF EXISTS public.core_password_resets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
-- [END AUTO_GENERATED_ADD_COLUMNS]

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stk_stock_levels' AND column_name = 'id' AND data_type = 'text'
  ) THEN
    ALTER TABLE public.stk_stock_levels ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_levels_product_depot ON public.stk_stock_levels (product_id, depot_name);
CREATE INDEX IF NOT EXISTS idx_stock_levels_depot ON public.stk_stock_levels (depot_name);

-- 0.2 Colonnes requises sécurisées et conversion additive des identifiants utilisateur en TEXT
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'core_users') THEN
    ALTER TABLE public.core_users 
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

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stk_material_orders') THEN
    ALTER TABLE public.stk_material_orders 
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

    CREATE INDEX IF NOT EXISTS idx_material_orders_delegate ON public.stk_material_orders (pickup_delegate_id);
    CREATE INDEX IF NOT EXISTS idx_material_orders_preparer ON public.stk_material_orders (preparer_id);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stk_movements') THEN
    ALTER TABLE public.stk_movements 
      ADD COLUMN IF NOT EXISTS user_id TEXT,
      ADD COLUMN IF NOT EXISTS reason TEXT,
      ADD COLUMN IF NOT EXISTS depot_name TEXT,
      ADD COLUMN IF NOT EXISTS dest_depot_name TEXT,
      ADD COLUMN IF NOT EXISTS site_number TEXT,
      ADD COLUMN IF NOT EXISTS department_name TEXT,
      ADD COLUMN IF NOT EXISTS total_cost NUMERIC(12, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS order_number TEXT;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'core_departments') THEN
    ALTER TABLE public.core_departments 
      ADD COLUMN IF NOT EXISTS manager_id TEXT,
      ADD COLUMN IF NOT EXISTS deputy_manager_ids TEXT[] DEFAULT '{}';

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'core_departments' AND column_name = 'deputy_manager_ids'
        AND udt_name IN ('_int4', '_int8', '_int2')
    ) THEN
      DROP VIEW IF EXISTS public.departments;
      ALTER TABLE public.core_departments ALTER COLUMN deputy_manager_ids DROP DEFAULT;
      ALTER TABLE public.core_departments ALTER COLUMN deputy_manager_ids TYPE TEXT[] USING deputy_manager_ids::text[];
      ALTER TABLE public.core_departments ALTER COLUMN deputy_manager_ids SET DEFAULT '{}';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'core_projects') THEN
    ALTER TABLE public.core_projects 
      ADD COLUMN IF NOT EXISTS manager_id TEXT,
      ADD COLUMN IF NOT EXISTS deputy_manager_ids TEXT[] DEFAULT '{}';

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'core_projects' AND column_name = 'deputy_manager_ids'
        AND udt_name IN ('_int4', '_int8', '_int2')
    ) THEN
      DROP VIEW IF EXISTS public.projects;
      ALTER TABLE public.core_projects ALTER COLUMN deputy_manager_ids DROP DEFAULT;
      ALTER TABLE public.core_projects ALTER COLUMN deputy_manager_ids TYPE TEXT[] USING deputy_manager_ids::text[];
      ALTER TABLE public.core_projects ALTER COLUMN deputy_manager_ids SET DEFAULT '{}';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stk_depots') THEN
    ALTER TABLE public.stk_depots 
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
  SELECT id::text FROM public.core_users WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false LIMIT 1;
$$;

DROP FUNCTION IF EXISTS public.current_user_role() CASCADE;
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role_id FROM public.core_users WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false LIMIT 1;
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
  SELECT role_id INTO v_role_id FROM public.core_users WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false LIMIT 1;
  IF v_role_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF v_role_id = 0 THEN
    RETURN TRUE;
  END IF;
  SELECT permissions INTO v_perms FROM public.core_roles WHERE id::text = v_role_id::text LIMIT 1;
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
  FROM public.core_users
  WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
  LIMIT 1;

  IF v_caller_id IS NULL OR v_is_blocked = TRUE THEN
    RETURN FALSE;
  END IF;

  IF public.is_administrator() OR public.current_user_has_perm('perm_mov_view_all') THEN
    RETURN TRUE;
  END IF;

  IF p_mov_user_id IS NOT NULL AND (p_mov_user_id::text = v_caller_id::text OR p_mov_user_id::text = auth.uid()::text) THEN
    RETURN TRUE;
  END IF;

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

GRANT EXECUTE ON FUNCTION public.current_user_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_has_perm(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_administrator() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_movement(TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

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
-- 2.1 FONCTION INTERNE DE PURGE TOTALE DES RÈGLES RLS PAR TABLE (v37)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tot_drop_all_policies_on_table(p_table_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = p_table_name AND c.relkind = 'r'
  ) THEN
    FOR r IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = p_table_name
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, p_table_name);
    END LOOP;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._tot_drop_all_policies_on_table(TEXT) FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- 3. DURCISSEMENT TABLE : public.core_users (Sécurité V18)
-- -------------------------------------------------------------------------
ALTER TABLE public.core_users ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN PERFORM public._tot_drop_all_policies_on_table('core_users'); END $$;

REVOKE ALL ON TABLE public.core_users FROM anon, authenticated, public;
GRANT SELECT (
  id, name, trigram, email, department, role_id, is_blocked,
  allowed_depots, must_change_pin, is_preparer, auth_user_id, created_at, updated_at
) ON TABLE public.core_users TO authenticated;

CREATE POLICY "Authenticated read users"
  ON public.core_users
  FOR SELECT
  TO authenticated
  USING (public.current_user_id() IS NOT NULL);

DROP FUNCTION IF EXISTS public.get_login_users_directory() CASCADE;
DROP FUNCTION IF EXISTS public.get_login_directory() CASCADE;

-- -------------------------------------------------------------------------
-- 4. DURCISSEMENT TABLE : public.core_license_config
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'core_license_config' AND column_name = 'plan'
  ) THEN
    UPDATE public.core_license_config
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
    WHERE table_schema = 'public' AND table_name = 'core_license_config' AND column_name = 'plan_type'
  ) THEN
    EXECUTE $upd$
      UPDATE public.core_license_config
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

ALTER TABLE public.core_license_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN PERFORM public._tot_drop_all_policies_on_table('core_license_config'); END $$;

REVOKE ALL ON TABLE public.core_license_config FROM anon, public;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.core_license_config FROM authenticated;
GRANT SELECT ON TABLE public.core_license_config TO authenticated;

CREATE POLICY "Authenticated read license_config"
  ON public.core_license_config
  FOR SELECT
  TO authenticated
  USING (true);

-- -------------------------------------------------------------------------
-- 5. DURCISSEMENT TABLES : public.core_app_settings & public.core_company_settings
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.core_app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.core_app_settings
  ADD COLUMN IF NOT EXISTS key TEXT,
  ADD COLUMN IF NOT EXISTS value TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_core_app_settings_key_uq ON public.core_app_settings (key);

CREATE TABLE IF NOT EXISTS public.core_company_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.core_company_settings
  ADD COLUMN IF NOT EXISTS key TEXT,
  ADD COLUMN IF NOT EXISTS value TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_core_company_settings_key_uq ON public.core_company_settings (key);

-- Si une ancienne table app_settings ou company_settings possédait une colonne id bloquante (clé primaire ou NOT NULL sans défaut),
-- la rendre optionnelle pour permettre l'insertion par (key, value)
DO $$
DECLARE
  v_tbl TEXT;
  v_con RECORD;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['core_app_settings', 'core_company_settings'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_tbl AND column_name = 'id'
    ) THEN
      FOR v_con IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = format('public.%I', v_tbl)::regclass
          AND c.contype = 'p'
          AND a.attname = 'id'
      LOOP
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', v_tbl, v_con.conname);
      END LOOP;
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id DROP NOT NULL', v_tbl);
    END IF;
  END LOOP;
END $$;

INSERT INTO public.core_app_settings (key, value)
VALUES ('company_currency', 'EUR')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.core_company_settings (key, value)
VALUES ('company_currency', 'EUR')
ON CONFLICT (key) DO NOTHING;

-- RLS & Policies pour core_app_settings
ALTER TABLE public.core_app_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN PERFORM public._tot_drop_all_policies_on_table('core_app_settings'); END $$;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.core_app_settings FROM anon, public;
GRANT SELECT ON TABLE public.core_app_settings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.core_app_settings TO authenticated;

CREATE POLICY "Anon public settings"
  ON public.core_app_settings
  FOR SELECT
  TO anon
  USING (key IN ('company_currency', 'company_name', 'company_logo', 'app_logo_url'));

CREATE POLICY "Authenticated read app_settings"
  ON public.core_app_settings
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_id() IS NOT NULL
    AND key NOT IN ('smtp_pass', 'brevo_api_key', 'sendinblue_api_key')
  );

CREATE POLICY "Admin write app_settings"
  ON public.core_app_settings
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

-- RLS & Policies pour core_company_settings
ALTER TABLE public.core_company_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN PERFORM public._tot_drop_all_policies_on_table('core_company_settings'); END $$;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.core_company_settings FROM anon, public;
GRANT SELECT ON TABLE public.core_company_settings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.core_company_settings TO authenticated;

CREATE POLICY "Anon public company_settings"
  ON public.core_company_settings
  FOR SELECT
  TO anon
  USING (key IN ('company_currency', 'company_name', 'company_logo', 'app_logo_url'));

CREATE POLICY "Authenticated read company_settings"
  ON public.core_company_settings
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_id() IS NOT NULL
    AND key NOT IN ('smtp_pass', 'brevo_api_key', 'sendinblue_api_key')
  );

CREATE POLICY "Admin write company_settings"
  ON public.core_company_settings
  FOR ALL
  TO authenticated
  USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_config_db'))
  WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_config_db'));

CREATE OR REPLACE FUNCTION public.sync_app_and_company_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME IN ('core_app_settings', 'app_settings') THEN
    INSERT INTO public.core_company_settings (key, value, updated_at)
    VALUES (NEW.key, NEW.value, NEW.updated_at)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
  ELSIF TG_TABLE_NAME IN ('core_company_settings', 'company_settings') THEN
    INSERT INTO public.core_app_settings (key, value, updated_at)
    VALUES (NEW.key, NEW.value, NEW.updated_at)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_app_to_company ON public.core_app_settings;
CREATE TRIGGER trg_sync_app_to_company
  AFTER INSERT OR UPDATE ON public.core_app_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_app_and_company_settings();

DROP TRIGGER IF EXISTS trg_sync_company_to_app ON public.core_company_settings;
CREATE TRIGGER trg_sync_company_to_app
  AFTER INSERT OR UPDATE ON public.core_company_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_app_and_company_settings();

-- -------------------------------------------------------------------------
-- 6. DURCISSEMENT TABLE : public.stk_movements
-- -------------------------------------------------------------------------
ALTER TABLE public.stk_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stk_movements FROM anon, public;
GRANT SELECT, INSERT ON TABLE public.stk_movements TO authenticated;
DO $$ BEGIN PERFORM public._tot_drop_all_policies_on_table('stk_movements'); END $$;

CREATE POLICY "Authenticated read stock_movements"
  ON public.stk_movements
  FOR SELECT
  TO authenticated
  USING (public.can_view_movement(user_id::text, department_name::text, depot_name::text, site_number::text));

CREATE POLICY "Authenticated insert stock_movements"
  ON public.stk_movements
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id::text = public.current_user_id() OR user_id::text = auth.uid()::text);

-- -------------------------------------------------------------------------
-- 7. DURCISSEMENT TABLE : public.stk_products & SOURCE DE VÉRITÉ DU STOCK
-- -------------------------------------------------------------------------
ALTER TABLE public.stk_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stk_products FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stk_products TO authenticated;
DO $$ BEGIN PERFORM public._tot_drop_all_policies_on_table('stk_products'); END $$;

CREATE POLICY "Authenticated read products"
  ON public.stk_products
  FOR SELECT
  TO authenticated
  USING (public.current_user_id() IS NOT NULL);

CREATE POLICY "Admin write products"
  ON public.stk_products
  FOR ALL
  TO authenticated
  USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_prod_edit') OR public.current_user_has_perm('perm_action_create_prod'))
  WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_prod_edit') OR public.current_user_has_perm('perm_action_create_prod'));

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

DROP TRIGGER IF EXISTS trg_check_product_quantity_update ON public.stk_products;
CREATE TRIGGER trg_check_product_quantity_update
  BEFORE UPDATE ON public.stk_products
  FOR EACH ROW
  EXECUTE FUNCTION public.check_product_quantity_update();

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
  FROM public.stk_products p
  LEFT JOIN public.stk_stock_levels sl ON sl.product_id::text = p.id::text
  GROUP BY p.id, p.reference, p.quantity;
$$;

-- -------------------------------------------------------------------------
-- 8. DURCISSEMENT TABLE : public.stk_material_orders (& stk_material_order_items si présente)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_is_dept_or_proj_manager_for_order(
  p_requester_department TEXT,
  p_site_number TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cid TEXT := public.current_user_id();
  v_crole INT := public.current_user_role();
  v_u_dept TEXT;
  v_req_dept TEXT := LOWER(TRIM(COALESCE(p_requester_department, '')));
  v_site TEXT := UPPER(TRIM(COALESCE(p_site_number, '')));
BEGIN
  IF v_cid IS NULL THEN
    RETURN false;
  END IF;

  IF v_site <> '' AND EXISTS (
    SELECT 1 FROM public.core_projects p
    WHERE (UPPER(TRIM(p.project_number)) = v_site OR v_site LIKE '%' || UPPER(TRIM(p.project_number)) || '%')
      AND (
        p.manager_id::text = v_cid
        OR (p.deputy_manager_ids IS NOT NULL AND v_cid = ANY(ARRAY(SELECT unnest(p.deputy_manager_ids)::text)))
      )
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.core_departments d
    WHERE (
      d.manager_id::text = v_cid
      OR (d.deputy_manager_ids IS NOT NULL AND v_cid = ANY(ARRAY(SELECT unnest(d.deputy_manager_ids)::text)))
    )
    AND (
      (v_req_dept <> '' AND (LOWER(TRIM(d.name::text)) = v_req_dept OR LOWER(TRIM(d.id::text)) = v_req_dept))
      OR (
        v_site <> '' AND EXISTS (
          SELECT 1 FROM public.core_projects p
          WHERE p.department_id::text = d.id::text
            AND (UPPER(TRIM(p.project_number)) = v_site OR v_site LIKE '%' || UPPER(TRIM(p.project_number)) || '%')
        )
      )
    )
  ) THEN
    RETURN true;
  END IF;

  IF v_crole = 8 THEN
    SELECT LOWER(TRIM(COALESCE(u.department, ''))) INTO v_u_dept
    FROM public.core_users u
    WHERE u.id::text = v_cid
    LIMIT 1;

    IF v_u_dept IS NOT NULL AND v_u_dept <> '' THEN
      IF v_req_dept <> '' AND v_req_dept = v_u_dept THEN
        RETURN true;
      END IF;
      IF v_site <> '' AND EXISTS (
        SELECT 1
        FROM public.core_projects p
        JOIN public.core_departments d ON d.id::text = p.department_id::text
        WHERE LOWER(TRIM(d.name::text)) = v_u_dept
          AND (UPPER(TRIM(p.project_number)) = v_site OR v_site LIKE '%' || UPPER(TRIM(p.project_number)) || '%')
      ) THEN
        RETURN true;
      END IF;
    END IF;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.current_user_is_dept_or_proj_manager_for_order(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_dept_or_proj_manager_for_order(TEXT, TEXT) TO authenticated;

ALTER TABLE public.stk_material_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stk_material_orders FROM anon, public;
GRANT SELECT, INSERT, UPDATE ON TABLE public.stk_material_orders TO authenticated;
DO $$ BEGIN PERFORM public._tot_drop_all_policies_on_table('stk_material_orders'); END $$;

CREATE POLICY "Authenticated read material_orders"
  ON public.stk_material_orders
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
    OR public.current_user_is_dept_or_proj_manager_for_order(requester_department, site_number)
  );

CREATE POLICY "Authenticated insert material_orders"
  ON public.stk_material_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_id() IS NOT NULL
    AND status IN ('WAITING_APPROVAL', 'PENDING')
  );

CREATE POLICY "Authenticated update material_orders"
  ON public.stk_material_orders
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
    OR public.current_user_is_dept_or_proj_manager_for_order(requester_department, site_number)
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
    OR public.current_user_is_dept_or_proj_manager_for_order(requester_department, site_number)
  );

-- Durcissement de public.stk_material_order_items (ou material_order_items si créée après 09)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'material_order_items' AND c.relkind = 'r'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'stk_material_order_items' AND c.relkind = 'r'
  ) THEN
    DROP VIEW IF EXISTS public.stk_material_order_items;
    ALTER TABLE public.material_order_items RENAME TO stk_material_order_items;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'stk_material_order_items' AND c.relkind = 'r'
  ) THEN
    ALTER TABLE public.stk_material_order_items ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.stk_material_order_items FROM anon, public;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stk_material_order_items TO authenticated;
    PERFORM public._tot_drop_all_policies_on_table('stk_material_order_items');

    CREATE POLICY "Authenticated read material_order_items"
      ON public.stk_material_order_items
      FOR SELECT
      TO authenticated
      USING (public.current_user_id() IS NOT NULL);

    CREATE POLICY "Authenticated write material_order_items"
      ON public.stk_material_order_items
      FOR ALL
      TO authenticated
      USING (public.current_user_id() IS NOT NULL)
      WITH CHECK (public.current_user_id() IS NOT NULL);
  END IF;
END $$;

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
  IF auth.uid() IS NULL OR v_cid IS NULL THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF OLD.status IN ('COLLECTED', 'CANCELLED', 'REJECTED') THEN
    RAISE EXCEPTION 'Commande % déjà clôturée (%): aucune modification autorisée.',
      OLD.order_number, OLD.status
      USING ERRCODE = '22023';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.order_number IS DISTINCT FROM OLD.order_number OR NEW.requester_id IS DISTINCT FROM OLD.requester_id THEN
    RAISE EXCEPTION 'Modification interdite des champs structurels de la commande (id, order_number, requester_id).'
      USING ERRCODE = '42501';
  END IF;

  IF v_crole IN (0, 1, 2, 6, 7, 8)
     OR public.current_user_has_perm('perm_order_approve')
     OR public.current_user_has_perm('perm_orders_manage')
     OR public.current_user_is_dept_or_proj_manager_for_order(OLD.requester_department, OLD.site_number) THEN
    v_is_approver := true;
  END IF;

  v_is_prep := (
    v_crole IN (0, 1, 2, 6, 7)
    OR public.current_user_has_perm('perm_menu_order_prep')
    OR public.current_user_has_perm('perm_order_assign')
    OR public.current_user_has_perm('perm_order_mark_ready')
    OR public.current_user_has_perm('perm_orders_manage')
  );

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'WAITING_APPROVAL' AND NEW.status IN ('PENDING', 'REJECTED') THEN
      IF OLD.requester_id::text = v_cid::text AND NOT (v_crole = 0 OR v_is_approver) THEN
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

  IF OLD.requester_id::text = v_cid::text AND v_crole != 0 AND NOT v_is_prep AND NOT v_is_approver THEN
    IF OLD.status NOT IN ('WAITING_APPROVAL', 'PENDING') AND NEW.status = OLD.status THEN
      RAISE EXCEPTION 'La commande est en cours de traitement et ne peut plus être modifiée par le demandeur.'
        USING ERRCODE = '42501';
    END IF;

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

DROP TRIGGER IF EXISTS trg_check_material_orders_update ON public.stk_material_orders;
CREATE TRIGGER trg_check_material_orders_update
  BEFORE UPDATE ON public.stk_material_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.check_material_orders_update();

-- -------------------------------------------------------------------------
-- 9. AUTRES TABLES SYSTÈME : core_roles, core_departments, core_projects, stk_sub_categories, stk_depots, stk_stock_levels
-- -------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'core_roles') THEN
    ALTER TABLE public.core_roles ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.core_roles FROM anon, public;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.core_roles TO authenticated;
    PERFORM public._tot_drop_all_policies_on_table('core_roles');
    CREATE POLICY "Authenticated read roles" ON public.core_roles FOR SELECT TO authenticated
      USING (public.current_user_id() IS NOT NULL);
    CREATE POLICY "Admin write roles" ON public.core_roles FOR ALL TO authenticated
      USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_roles'))
      WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_roles'));
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'core_departments') THEN
    ALTER TABLE public.core_departments ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.core_departments FROM anon, public;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.core_departments TO authenticated;
    PERFORM public._tot_drop_all_policies_on_table('core_departments');
    CREATE POLICY "Authenticated read departments" ON public.core_departments FOR SELECT TO authenticated
      USING (public.current_user_id() IS NOT NULL);
    CREATE POLICY "Admin write departments" ON public.core_departments FOR ALL TO authenticated
      USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_depproj_menu') OR public.current_user_has_perm('perm_dep_edit'))
      WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_depproj_menu') OR public.current_user_has_perm('perm_dep_edit'));
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'core_projects') THEN
    ALTER TABLE public.core_projects ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.core_projects FROM anon, public;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.core_projects TO authenticated;
    PERFORM public._tot_drop_all_policies_on_table('core_projects');
    CREATE POLICY "Authenticated read projects" ON public.core_projects FOR SELECT TO authenticated
      USING (public.current_user_id() IS NOT NULL);
    CREATE POLICY "Admin write projects" ON public.core_projects FOR ALL TO authenticated
      USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_depproj_menu') OR public.current_user_has_perm('perm_proj_edit'))
      WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_depproj_menu') OR public.current_user_has_perm('perm_proj_edit'));
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stk_sub_categories') THEN
    ALTER TABLE public.stk_sub_categories ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.stk_sub_categories FROM anon, public;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stk_sub_categories TO authenticated;
    PERFORM public._tot_drop_all_policies_on_table('stk_sub_categories');
    CREATE POLICY "Authenticated read sub_categories" ON public.stk_sub_categories FOR SELECT TO authenticated
      USING (public.current_user_id() IS NOT NULL);
    CREATE POLICY "Admin write sub_categories" ON public.stk_sub_categories FOR ALL TO authenticated
      USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_categories') OR public.current_user_has_perm('perm_prod_edit'))
      WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_categories') OR public.current_user_has_perm('perm_prod_edit'));
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stk_depots') THEN
    ALTER TABLE public.stk_depots ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.stk_depots FROM anon, public;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stk_depots TO authenticated;
    PERFORM public._tot_drop_all_policies_on_table('stk_depots');
    CREATE POLICY "Authenticated read depots" ON public.stk_depots FOR SELECT TO authenticated
      USING (public.current_user_id() IS NOT NULL);
    CREATE POLICY "Admin write depots" ON public.stk_depots FOR ALL TO authenticated
      USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_depots') OR public.current_user_has_perm('perm_depot_create'))
      WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_depots') OR public.current_user_has_perm('perm_depot_create'));
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stk_stock_levels') THEN
    ALTER TABLE public.stk_stock_levels ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.stk_stock_levels FROM anon, public;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stk_stock_levels TO authenticated;
    PERFORM public._tot_drop_all_policies_on_table('stk_stock_levels');
    CREATE POLICY "Authenticated read stock_levels" ON public.stk_stock_levels
      FOR SELECT TO authenticated
      USING (
        public.is_administrator()
        OR public.current_user_has_perm('perm_mov_view_all')
        OR EXISTS (
          SELECT 1 FROM public.stk_depots d
          WHERE d.name = stk_stock_levels.depot_name
            AND (
              d.type = 'FIXED'
              OR d.type IS NULL
              OR d.manager_id::text = public.current_user_id()
              OR (
                SELECT allowed_depots FROM public.core_users WHERE id::text = public.current_user_id()
              ) @> ARRAY[d.name]
              OR '*'::text = ANY(COALESCE((SELECT allowed_depots FROM public.core_users WHERE id::text = public.current_user_id()), '{}'::text[]))
              OR (
                d.type = 'CONTAINER' AND d.project_number IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.core_projects p
                  WHERE p.project_number = d.project_number
                    AND (p.manager_id::text = public.current_user_id() OR public.current_user_id() = ANY(ARRAY(SELECT unnest(p.deputy_manager_ids)::text)))
                )
              )
            )
        )
      );
    CREATE POLICY "Admin write stock_levels" ON public.stk_stock_levels
      FOR ALL TO authenticated
      USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_menu_inventory_audit') OR public.current_user_has_perm('perm_prod_edit'))
      WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_menu_inventory_audit') OR public.current_user_has_perm('perm_prod_edit'));
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 10. DURCISSEMENT TABLE : public.core_audit_logs (& public.core_login_logs si présente)
-- -------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'core_audit_logs') THEN
    ALTER TABLE public.core_audit_logs ADD COLUMN IF NOT EXISTS app TEXT DEFAULT 'stock';
    ALTER TABLE public.core_audit_logs ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.core_audit_logs FROM anon, public;
    GRANT SELECT, INSERT ON TABLE public.core_audit_logs TO authenticated;
    PERFORM public._tot_drop_all_policies_on_table('core_audit_logs');

    CREATE POLICY "Authenticated read audit_logs"
      ON public.core_audit_logs
      FOR SELECT
      TO authenticated
      USING (
        public.current_user_role() = 0
        OR public.current_user_has_perm('perm_menu_inventory_audit')
        OR public.current_user_has_perm('perm_view_all_login_logs')
      );

    CREATE POLICY "Authenticated insert audit_logs"
      ON public.core_audit_logs
      FOR INSERT
      TO authenticated
      WITH CHECK (
        user_id::text = public.current_user_id()
        OR user_id::text = auth.uid()::text
        OR auth.uid() IS NULL
      );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'core_login_logs') THEN
    ALTER TABLE public.core_login_logs ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.core_login_logs FROM anon, public;
    GRANT SELECT, INSERT ON TABLE public.core_login_logs TO authenticated;
    PERFORM public._tot_drop_all_policies_on_table('core_login_logs');

    CREATE POLICY "Authenticated read login_logs"
      ON public.core_login_logs
      FOR SELECT
      TO authenticated
      USING (
        public.current_user_role() = 0
        OR public.current_user_has_perm('perm_view_all_login_logs')
      );

    CREATE POLICY "Authenticated insert login_logs"
      ON public.core_login_logs
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

  BEGIN
    SELECT value INTO v_sender_email
    FROM public.core_app_settings
    WHERE key IN ('smtp_from', 'brevo_sender_email')
    LIMIT 1;

    SELECT value INTO v_sender_name
    FROM public.core_app_settings
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

-- Suppression de la fonction utilitaire interne de purge RLS en fin de script
DROP FUNCTION IF EXISTS public._tot_drop_all_policies_on_table(TEXT);

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
-- 12. PUBLICATION REALTIME PROTÉGÉE (SYNCHRONISATION TEMPS RÉEL MOBILE <-> BUREAU)
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_tbl TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH v_tbl IN ARRAY ARRAY[
      'stk_products', 'stk_stock_levels', 'stk_movements',
      'stk_material_orders', 'stk_depots', 'core_departments', 'core_projects',
      'stk_sub_categories', 'core_users', 'core_roles', 'core_app_settings',
      'core_license_config'
    ] LOOP
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = v_tbl
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_tbl
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_tbl);
      END IF;
    END LOOP;
  END IF;
END $$;
