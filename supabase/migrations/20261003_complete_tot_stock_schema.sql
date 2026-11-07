-- =========================================================================
-- TOT STOCK - SCRIPT 00 : SCHÉMA INITIAL COMPLET (00_complete_tot_stock_schema.sql)
-- Description : Création initiale des tables core_* et stk_*, index et RLS de base.
-- Dépendances : Aucune (premier script sur base neuve ; optionnel si les tables existent déjà).
-- Ordre d'exécution : 00 → 09 → 01 (→ 01b) → 02 → 03 → 04 → 05 → 06 → 08 → 11 → 12 → 13 → 14 → 07
-- Rejouable : oui (100 % idempotent : IF NOT EXISTS)
-- =========================================================================

-- =========================================================================
-- GUIDE D'EXÉCUTION TERMINAL CLI (SUPABASE CLI & PSQL)
-- =========================================================================
-- MÉTHODE 1 (Supabase CLI) :
--   1. npx supabase login
--   2. npx supabase link --project-ref <VOTRE_PROJECT_REF>
--   3. npx supabase db push
--
-- MÉTHODE 2 (PostgreSQL psql direct) :
--   psql "postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" -f dist/install.sql
--
-- MÉTHODE 3 (Console Web Supabase) :
--   Ouvrir https://supabase.com/dashboard/project/<PROJECT_REF>/sql
--   Coller dist/install.sql dans l'éditeur et cliquer sur "Run".
-- =========================================================================

-- 1. TABLE CORE_ROLES
CREATE TABLE IF NOT EXISTS public.core_roles (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  permissions TEXT[] NOT NULL DEFAULT '{}'
);

-- Insertion des rôles système par défaut
INSERT INTO public.core_roles (id, name, permissions)
VALUES 
  (0, 'Super Administrateur', '{"*"}'),
  (1, 'Administrateur', '{"perm_inventory_view","perm_inventory_create","perm_inventory_edit","perm_inventory_delete","perm_stock_in","perm_stock_out","perm_mov_tabs","perm_mov_tab_my","perm_mov_tab_proj","perm_mov_tab_orders","perm_mov_filter_dep","perm_mov_export_csv","perm_reports_view","perm_reports_audit","perm_users_view","perm_users_manage","perm_settings_manage","perm_depots_manage","perm_orders_view","perm_orders_manage"}'),
  (2, 'Responsable Dépôt / Magasinier', '{"perm_inventory_view","perm_inventory_create","perm_inventory_edit","perm_stock_in","perm_stock_out","perm_mov_tabs","perm_mov_tab_my","perm_mov_tab_proj","perm_mov_tab_orders","perm_mov_filter_dep","perm_mov_export_csv","perm_reports_view","perm_depots_manage","perm_orders_view","perm_orders_manage"}'),
  (3, 'Chef de Chantier / Conducteur', '{"perm_inventory_view","perm_stock_out","perm_mov_tabs","perm_mov_tab_my","perm_mov_tab_proj","perm_orders_view"}'),
  (4, 'Opérateur Standard / Demandeur', '{"perm_inventory_view","perm_stock_out","perm_mov_tabs","perm_mov_tab_my"}')
ON CONFLICT (id) DO NOTHING;

-- 2. TABLE CORE_DEPARTMENTS (Départements / Services avec validation hiérarchique débrayable)
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

ALTER TABLE public.core_departments 
  ADD COLUMN IF NOT EXISTS manager_id TEXT,
  ADD COLUMN IF NOT EXISTS deputy_manager_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allow_global_kpis BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_preparer_dept BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_order_approval BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS order_approval_threshold NUMERIC(10,2) DEFAULT 0;

-- 3. TABLE CORE_USERS (Utilisateurs & Accès Auth / PIN)
CREATE TABLE IF NOT EXISTS public.core_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigram TEXT,
  email TEXT,
  department TEXT,
  pin TEXT NOT NULL DEFAULT '',
  pin_hash TEXT,
  role_id BIGINT REFERENCES public.core_roles(id) DEFAULT 4,
  is_blocked BOOLEAN DEFAULT false,
  allowed_depots TEXT[] DEFAULT NULL,
  must_change_pin BOOLEAN DEFAULT false,
  is_preparer BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.core_users 
  ADD COLUMN IF NOT EXISTS allowed_depots TEXT[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_preparer BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pin_hash TEXT;

-- 4. TABLE CORE_PROJECTS (Chantiers & Projets)
CREATE TABLE IF NOT EXISTS public.core_projects (
  id BIGSERIAL PRIMARY KEY,
  department_id BIGINT REFERENCES public.core_departments(id),
  project_number TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL,
  manager_id TEXT,
  deputy_manager_ids TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.core_projects 
  ADD COLUMN IF NOT EXISTS deputy_manager_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS manager_id TEXT;

-- 5. TABLE STK_SUB_CATEGORIES (Catégories d'outillage & consommables)
CREATE TABLE IF NOT EXISTS public.stk_sub_categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. TABLE STK_DEPOTS (Dépôts physiques, magasins, véhicules & ateliers)
CREATE TABLE IF NOT EXISTS public.stk_depots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  address TEXT,
  description TEXT,
  pickup_zones TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.stk_depots 
  ADD COLUMN IF NOT EXISTS pickup_zones TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- 7. TABLE STK_PRODUCTS (Catalogue Références, Outillage & Stocks)
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

ALTER TABLE public.stk_products 
  ADD COLUMN IF NOT EXISTS manufacturer_ref TEXT,
  ADD COLUMN IF NOT EXISTS barcode TEXT,
  ADD COLUMN IF NOT EXISTS supplier_1_name TEXT,
  ADD COLUMN IF NOT EXISTS ref_supplier_1 TEXT,
  ADD COLUMN IF NOT EXISTS supplier_2_name TEXT,
  ADD COLUMN IF NOT EXISTS ref_supplier_2 TEXT,
  ADD COLUMN IF NOT EXISTS store_name TEXT,
  ADD COLUMN IF NOT EXISTS room_name TEXT,
  ADD COLUMN IF NOT EXISTS shelf_name TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT;

-- 8. TABLE STK_MOVEMENTS (Historique & Traçabilité des Flux)
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

ALTER TABLE public.stk_movements 
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS depot_name TEXT,
  ADD COLUMN IF NOT EXISTS dest_depot_name TEXT,
  ADD COLUMN IF NOT EXISTS order_number TEXT,
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS department_name TEXT;

-- 9. TABLE STK_MATERIAL_ORDERS (Commandes de matériel, Drive Chantier, Validation & Préparation)
CREATE TABLE IF NOT EXISTS public.stk_material_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  site_number TEXT NOT NULL,
  site_name TEXT,
  depot_name TEXT,
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
  ready_at TIMESTAMPTZ,
  collected_at TIMESTAMPTZ,
  collected_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.stk_material_orders 
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS pickup_zone TEXT,
  ADD COLUMN IF NOT EXISTS ready_qr_code TEXT,
  ADD COLUMN IF NOT EXISTS depot_name TEXT,
  ADD COLUMN IF NOT EXISTS signature_data TEXT,
  ADD COLUMN IF NOT EXISTS proof_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DO $$ 
BEGIN 
  ALTER TABLE public.stk_material_orders DROP CONSTRAINT IF EXISTS material_orders_status_check;
  ALTER TABLE public.stk_material_orders DROP CONSTRAINT IF EXISTS stk_material_orders_status_check;
  ALTER TABLE public.stk_material_orders ADD CONSTRAINT stk_material_orders_status_check 
    CHECK (status IN ('WAITING_APPROVAL', 'PENDING', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED', 'REJECTED'));
EXCEPTION WHEN OTHERS THEN 
  NULL;
END $$;

-- 10. TABLE CORE_APP_SETTINGS (Devise centrale & Configuration entreprise)
CREATE TABLE IF NOT EXISTS public.core_app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.core_app_settings (key, value)
VALUES ('company_currency', 'EUR')
ON CONFLICT (key) DO NOTHING;

-- 11. TABLE CORE_LOGIN_LOGS & CORE_AUDIT_LOGS
CREATE TABLE IF NOT EXISTS public.core_login_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  user_name TEXT,
  action TEXT DEFAULT 'LOGIN_SUCCESS',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.core_audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  app TEXT DEFAULT 'stock',
  type TEXT NOT NULL DEFAULT 'SYSTEM',
  category TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (category IN ('MOVEMENTS', 'SCANS', 'SYSTEM', 'ORDERS')),
  user_id TEXT,
  user_name TEXT,
  user_trigram TEXT,
  product_id TEXT,
  product_ref TEXT,
  quantity_changed INT,
  site_number TEXT,
  depot_name TEXT,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  badge_text TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.core_audit_logs
  ADD COLUMN IF NOT EXISTS app TEXT DEFAULT 'stock';

-- =========================================================================
-- 12. SÉCURITÉ ROW LEVEL SECURITY (RLS) SUR TOUTES LES TABLES
-- =========================================================================
ALTER TABLE public.core_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon roles" ON public.core_roles;
DROP POLICY IF EXISTS "Authenticated read roles" ON public.core_roles;
CREATE POLICY "Authenticated read roles" ON public.core_roles FOR SELECT TO authenticated USING (true);

ALTER TABLE public.core_departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon departments" ON public.core_departments;
DROP POLICY IF EXISTS "Authenticated read departments" ON public.core_departments;
CREATE POLICY "Authenticated read departments" ON public.core_departments FOR SELECT TO authenticated USING (true);

ALTER TABLE public.core_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon users" ON public.core_users;
DROP POLICY IF EXISTS "Authenticated read users" ON public.core_users;
CREATE POLICY "Authenticated read users" ON public.core_users FOR SELECT TO authenticated USING (true);

ALTER TABLE public.core_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon projects" ON public.core_projects;
DROP POLICY IF EXISTS "Authenticated read projects" ON public.core_projects;
CREATE POLICY "Authenticated read projects" ON public.core_projects FOR SELECT TO authenticated USING (true);

ALTER TABLE public.stk_sub_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon sub_categories" ON public.stk_sub_categories;
DROP POLICY IF EXISTS "Authenticated read sub_categories" ON public.stk_sub_categories;
CREATE POLICY "Authenticated read sub_categories" ON public.stk_sub_categories FOR SELECT TO authenticated USING (true);

ALTER TABLE public.stk_depots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon depots" ON public.stk_depots;
DROP POLICY IF EXISTS "Authenticated read depots" ON public.stk_depots;
CREATE POLICY "Authenticated read depots" ON public.stk_depots FOR SELECT TO authenticated USING (true);

ALTER TABLE public.stk_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon products" ON public.stk_products;
DROP POLICY IF EXISTS "Authenticated read products" ON public.stk_products;
CREATE POLICY "Authenticated read products" ON public.stk_products FOR SELECT TO authenticated USING (true);

ALTER TABLE public.stk_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon stock_movements" ON public.stk_movements;
DROP POLICY IF EXISTS "Authenticated read stock_movements" ON public.stk_movements;
CREATE POLICY "Authenticated read stock_movements" ON public.stk_movements FOR SELECT TO authenticated USING (true);

ALTER TABLE public.stk_material_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon material_orders" ON public.stk_material_orders;
DROP POLICY IF EXISTS "Authenticated read material_orders" ON public.stk_material_orders;
CREATE POLICY "Authenticated read material_orders" ON public.stk_material_orders FOR SELECT TO authenticated USING (true);

ALTER TABLE public.core_app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon app_settings" ON public.core_app_settings;
DROP POLICY IF EXISTS "Anon public app_settings" ON public.core_app_settings;
DROP POLICY IF EXISTS "Authenticated read app_settings" ON public.core_app_settings;
CREATE POLICY "Anon public app_settings" ON public.core_app_settings FOR SELECT TO anon USING (key IN ('company_currency', 'company_name', 'company_logo', 'app_logo_url'));
CREATE POLICY "Authenticated read app_settings" ON public.core_app_settings FOR SELECT TO authenticated USING (key NOT IN ('smtp_pass', 'brevo_api_key'));

ALTER TABLE public.core_login_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon login_logs" ON public.core_login_logs;
DROP POLICY IF EXISTS "Authenticated read login_logs" ON public.core_login_logs;
CREATE POLICY "Authenticated read login_logs" ON public.core_login_logs FOR SELECT TO authenticated USING (true);

ALTER TABLE public.core_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon audit_logs" ON public.core_audit_logs;
DROP POLICY IF EXISTS "Authenticated read audit_logs" ON public.core_audit_logs;
CREATE POLICY "Authenticated read audit_logs" ON public.core_audit_logs FOR SELECT TO authenticated USING (true);

-- =========================================================================
-- 13. INDEX DE HAUTE PERFORMANCE POUR RECHERCHE & RAPPORTS
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_products_brand_model ON public.stk_products (brand, model);
CREATE INDEX IF NOT EXISTS idx_products_ref ON public.stk_products (reference);
CREATE INDEX IF NOT EXISTS idx_products_store ON public.stk_products (store_name);
CREATE INDEX IF NOT EXISTS idx_products_subcat ON public.stk_products (sub_category_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.stk_products (barcode);

CREATE INDEX IF NOT EXISTS idx_users_allowed_depots ON public.core_users USING GIN (allowed_depots);
CREATE INDEX IF NOT EXISTS idx_users_dept ON public.core_users (department);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.core_users (role_id);

CREATE INDEX IF NOT EXISTS idx_dep_approval ON public.core_departments (require_order_approval);
CREATE INDEX IF NOT EXISTS idx_dep_kpi ON public.core_departments (allow_global_kpis);
CREATE INDEX IF NOT EXISTS idx_projects_dept ON public.core_projects (department_id);
CREATE INDEX IF NOT EXISTS idx_projects_number ON public.core_projects (project_number);

CREATE INDEX IF NOT EXISTS idx_movements_prod ON public.stk_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_movements_created ON public.stk_movements (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_order ON public.stk_movements (order_number);
CREATE INDEX IF NOT EXISTS idx_movements_site ON public.stk_movements (site_number);

CREATE INDEX IF NOT EXISTS idx_material_orders_status ON public.stk_material_orders (status);
CREATE INDEX IF NOT EXISTS idx_material_orders_site ON public.stk_material_orders (site_number);
CREATE INDEX IF NOT EXISTS idx_material_orders_requester ON public.stk_material_orders (requester_id);
CREATE INDEX IF NOT EXISTS idx_material_orders_preparer ON public.stk_material_orders (preparer_id);
CREATE INDEX IF NOT EXISTS idx_material_orders_created ON public.stk_material_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_orders_cost ON public.stk_material_orders (total_cost);

CREATE INDEX IF NOT EXISTS idx_login_logs_user_date ON public.core_login_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON public.core_audit_logs (created_at DESC);

-- =========================================================================
-- 14. PUBLICATION REALTIME POUR SYNCHRONISATION TEMPS RÉEL (MOBILE <-> BUREAU)
-- =========================================================================
DO $$
DECLARE
  v_tbl TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH v_tbl IN ARRAY ARRAY[
      'stk_products', 'stk_movements',
      'stk_material_orders', 'stk_depots', 'core_departments', 'core_projects',
      'stk_sub_categories', 'core_users', 'core_roles', 'core_app_settings'
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
