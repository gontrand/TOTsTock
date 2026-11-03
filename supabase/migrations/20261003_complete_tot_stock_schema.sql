-- =========================================================================
-- TOT STOCK PRO v5.5 - SCHÉMA COMPLET ET MIGRATION POSTGRESQL / SUPABASE
-- Compatible avec bases neuves ET bases existantes (Idempotent: IF NOT EXISTS)
-- Inclut : Gestion Dépôts, Multi-magasins, Préparateurs, Devise,
-- et Validation Hiérarchique Débrayable des Commandes par Département & Seuil
-- =========================================================================

-- =========================================================================
-- GUIDE D'EXÉCUTION TERMINAL CLI (SUPABASE CLI & PSQL)
-- =========================================================================
-- MÉTHODE 1 (Supabase CLI) :
--   1. npx supabase login
--   2. npx supabase link --project-ref <VOTRE_PROJECT_REF>
--   3. npx supabase migration new complete_tot_stock_v5_5
--   4. Copier ce script dans supabase/migrations/<timestamp>_complete_tot_stock_v5_5.sql
--   5. npx supabase db push
--
-- MÉTHODE 2 (PostgreSQL psql direct) :
--   psql "postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" -f complete_tot_stock_schema.sql
--
-- MÉTHODE 3 (Console Web Supabase) :
--   Ouvrir https://supabase.com/dashboard/project/<PROJECT_REF>/sql
--   Coller ce script dans l'éditeur et cliquer sur "Run".
-- =========================================================================

-- 1. TABLE ROLES
CREATE TABLE IF NOT EXISTS public.roles (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  permissions TEXT[] NOT NULL DEFAULT '{}'
);

-- Insertion des rôles système par défaut
INSERT INTO public.roles (id, name, permissions)
VALUES 
  (0, 'Super Administrateur', '{"*"}'),
  (1, 'Administrateur', '{"perm_inventory_view","perm_inventory_create","perm_inventory_edit","perm_inventory_delete","perm_stock_in","perm_stock_out","perm_mov_tabs","perm_mov_tab_my","perm_mov_tab_proj","perm_mov_tab_orders","perm_mov_filter_dep","perm_mov_export_csv","perm_reports_view","perm_reports_audit","perm_users_view","perm_users_manage","perm_settings_manage","perm_depots_manage","perm_orders_view","perm_orders_manage"}'),
  (2, 'Responsable Dépôt / Magasinier', '{"perm_inventory_view","perm_inventory_create","perm_inventory_edit","perm_stock_in","perm_stock_out","perm_mov_tabs","perm_mov_tab_my","perm_mov_tab_proj","perm_mov_tab_orders","perm_mov_filter_dep","perm_mov_export_csv","perm_reports_view","perm_depots_manage","perm_orders_view","perm_orders_manage"}'),
  (3, 'Chef de Chantier / Conducteur', '{"perm_inventory_view","perm_stock_out","perm_mov_tabs","perm_mov_tab_my","perm_mov_tab_proj","perm_orders_view"}'),
  (4, 'Opérateur Standard / Demandeur', '{"perm_inventory_view","perm_stock_out","perm_mov_tabs","perm_mov_tab_my"}')
ON CONFLICT (id) DO NOTHING;

-- 2. TABLE DEPARTMENTS (Départements / Services avec validation hiérarchique débrayable)
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

ALTER TABLE public.departments 
  ADD COLUMN IF NOT EXISTS manager_id TEXT,
  ADD COLUMN IF NOT EXISTS deputy_manager_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allow_global_kpis BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_preparer_dept BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_order_approval BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS order_approval_threshold NUMERIC(10,2) DEFAULT 0;

-- 3. TABLE USERS (Utilisateurs & Accès PIN)
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigram TEXT,
  email TEXT,
  department TEXT,
  pin TEXT NOT NULL,
  pin_hash TEXT,
  role_id BIGINT REFERENCES public.roles(id) DEFAULT 4,
  is_blocked BOOLEAN DEFAULT false,
  allowed_depots TEXT[] DEFAULT NULL,
  must_change_pin BOOLEAN DEFAULT false,
  is_preparer BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.users 
  ADD COLUMN IF NOT EXISTS allowed_depots TEXT[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_preparer BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pin_hash TEXT;

-- 4. TABLE PROJECTS (Chantiers & Projets)
CREATE TABLE IF NOT EXISTS public.projects (
  id BIGSERIAL PRIMARY KEY,
  department_id BIGINT REFERENCES public.departments(id),
  project_number TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL,
  manager_id TEXT,
  deputy_manager_ids TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.projects 
  ADD COLUMN IF NOT EXISTS deputy_manager_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS manager_id TEXT;

-- 5. TABLE SUB_CATEGORIES (Catégories d'outillage & consommables)
CREATE TABLE IF NOT EXISTS public.sub_categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. TABLE DEPOTS (Dépôts physiques, magasins, véhicules & ateliers)
CREATE TABLE IF NOT EXISTS public.depots (
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

ALTER TABLE public.depots 
  ADD COLUMN IF NOT EXISTS pickup_zones TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- 7. TABLE PRODUCTS (Catalogue Références, Outillage & Stocks)
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

ALTER TABLE public.products 
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

-- 8. TABLE STOCK_MOVEMENTS / MOVEMENTS (Historique & Traçabilité des Flux)
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
  total_cost NUMERIC(10,2) DEFAULT 0,
  order_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Alias movements pour compatibilité avec toutes les configurations
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
  total_cost NUMERIC(10,2) DEFAULT 0,
  order_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_movements 
  ADD COLUMN IF NOT EXISTS order_number TEXT,
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS department_name TEXT;

ALTER TABLE public.movements 
  ADD COLUMN IF NOT EXISTS order_number TEXT,
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS department_name TEXT;

-- 9. TABLE MATERIAL_ORDERS (Commandes de matériel, Drive Chantier, Validation & Préparation)
CREATE TABLE IF NOT EXISTS public.material_orders (
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

ALTER TABLE public.material_orders 
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

-- Mise à jour sécurisée de la contrainte status
DO $$ 
BEGIN 
  ALTER TABLE public.material_orders DROP CONSTRAINT IF EXISTS material_orders_status_check;
  ALTER TABLE public.material_orders ADD CONSTRAINT material_orders_status_check 
    CHECK (status IN ('WAITING_APPROVAL', 'PENDING', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED', 'REJECTED'));
EXCEPTION WHEN OTHERS THEN 
  NULL;
END $$;

-- 10. TABLE APP_SETTINGS (Devise centrale & Configuration entreprise)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.app_settings (key, value)
VALUES ('company_currency', 'EUR')
ON CONFLICT (key) DO NOTHING;

-- 11. TABLE LOGIN_LOGS & AUDIT_LOGS
CREATE TABLE IF NOT EXISTS public.login_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  user_name TEXT,
  action TEXT DEFAULT 'LOGIN_SUCCESS',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('MOVEMENTS', 'SCANS', 'SYSTEM')),
  user_id TEXT,
  user_name TEXT,
  user_trigram TEXT,
  product_id TEXT,
  product_ref TEXT,
  quantity_changed INT,
  site_number TEXT,
  depot_name TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  badge_text TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =========================================================================
-- 12. SÉCURITÉ ROW LEVEL SECURITY (RLS) SUR TOUTES LES TABLES
-- =========================================================================
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon roles" ON public.roles;
DROP POLICY IF EXISTS "Authenticated read roles" ON public.roles;
CREATE POLICY "Authenticated read roles" ON public.roles FOR SELECT TO authenticated USING (true);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon departments" ON public.departments;
DROP POLICY IF EXISTS "Authenticated read departments" ON public.departments;
CREATE POLICY "Authenticated read departments" ON public.departments FOR SELECT TO authenticated USING (true);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon users" ON public.users;
DROP POLICY IF EXISTS "Authenticated read users" ON public.users;
CREATE POLICY "Authenticated read users" ON public.users FOR SELECT TO authenticated USING (true);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon projects" ON public.projects;
DROP POLICY IF EXISTS "Authenticated read projects" ON public.projects;
CREATE POLICY "Authenticated read projects" ON public.projects FOR SELECT TO authenticated USING (true);

ALTER TABLE public.sub_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon sub_categories" ON public.sub_categories;
DROP POLICY IF EXISTS "Authenticated read sub_categories" ON public.sub_categories;
CREATE POLICY "Authenticated read sub_categories" ON public.sub_categories FOR SELECT TO authenticated USING (true);

ALTER TABLE public.depots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon depots" ON public.depots;
DROP POLICY IF EXISTS "Authenticated read depots" ON public.depots;
CREATE POLICY "Authenticated read depots" ON public.depots FOR SELECT TO authenticated USING (true);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon products" ON public.products;
DROP POLICY IF EXISTS "Authenticated read products" ON public.products;
CREATE POLICY "Authenticated read products" ON public.products FOR SELECT TO authenticated USING (true);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon stock_movements" ON public.stock_movements;
DROP POLICY IF EXISTS "Authenticated read stock_movements" ON public.stock_movements;
CREATE POLICY "Authenticated read stock_movements" ON public.stock_movements FOR SELECT TO authenticated USING (true);

ALTER TABLE public.movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon movements" ON public.movements;
DROP POLICY IF EXISTS "Authenticated read movements" ON public.movements;
CREATE POLICY "Authenticated read movements" ON public.movements FOR SELECT TO authenticated USING (true);

ALTER TABLE public.material_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon material_orders" ON public.material_orders;
DROP POLICY IF EXISTS "Authenticated read material_orders" ON public.material_orders;
CREATE POLICY "Authenticated read material_orders" ON public.material_orders FOR SELECT TO authenticated USING (true);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Anon public app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Authenticated read app_settings" ON public.app_settings;
CREATE POLICY "Anon public app_settings" ON public.app_settings FOR SELECT TO anon USING (key IN ('company_currency', 'company_name', 'company_logo', 'app_logo_url'));
CREATE POLICY "Authenticated read app_settings" ON public.app_settings FOR SELECT TO authenticated USING (key NOT IN ('smtp_pass', 'brevo_api_key'));

ALTER TABLE public.login_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon login_logs" ON public.login_logs;
DROP POLICY IF EXISTS "Authenticated read login_logs" ON public.login_logs;
CREATE POLICY "Authenticated read login_logs" ON public.login_logs FOR SELECT TO authenticated USING (true);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated read audit_logs" ON public.audit_logs;
CREATE POLICY "Authenticated read audit_logs" ON public.audit_logs FOR SELECT TO authenticated USING (true);

-- =========================================================================
-- 13. INDEX DE HAUTE PERFORMANCE POUR RECHERCHE & RAPPORTS
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_products_brand_model ON public.products (brand, model);
CREATE INDEX IF NOT EXISTS idx_products_ref ON public.products (reference);
CREATE INDEX IF NOT EXISTS idx_products_store ON public.products (store_name);
CREATE INDEX IF NOT EXISTS idx_products_subcat ON public.products (sub_category_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products (barcode);

CREATE INDEX IF NOT EXISTS idx_users_allowed_depots ON public.users USING GIN (allowed_depots);
CREATE INDEX IF NOT EXISTS idx_users_dept ON public.users (department);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users (role_id);

CREATE INDEX IF NOT EXISTS idx_dep_approval ON public.departments (require_order_approval);
CREATE INDEX IF NOT EXISTS idx_dep_kpi ON public.departments (allow_global_kpis);
CREATE INDEX IF NOT EXISTS idx_projects_dept ON public.projects (department_id);
CREATE INDEX IF NOT EXISTS idx_projects_number ON public.projects (project_number);

CREATE INDEX IF NOT EXISTS idx_movements_prod ON public.stock_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_movements_created ON public.stock_movements (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_order ON public.stock_movements (order_number);
CREATE INDEX IF NOT EXISTS idx_movements_site ON public.stock_movements (site_number);

CREATE INDEX IF NOT EXISTS idx_material_orders_status ON public.material_orders (status);
CREATE INDEX IF NOT EXISTS idx_material_orders_site ON public.material_orders (site_number);
CREATE INDEX IF NOT EXISTS idx_material_orders_requester ON public.material_orders (requester_id);
CREATE INDEX IF NOT EXISTS idx_material_orders_preparer ON public.material_orders (preparer_id);
CREATE INDEX IF NOT EXISTS idx_material_orders_created ON public.material_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_orders_cost ON public.material_orders (total_cost);

CREATE INDEX IF NOT EXISTS idx_login_logs_user_date ON public.login_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON public.audit_logs (created_at DESC);
