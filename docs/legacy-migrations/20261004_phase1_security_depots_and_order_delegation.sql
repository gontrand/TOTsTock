-- =========================================================================
-- TOT STOCK PRO v5.5 - MIGRATION PHASE 1 : SÉCURITÉ, DÉPÔTS & DÉLÉGATION DE RETRAIT
-- Recommandations d'audit & durcissement de l'architecture Supabase
-- Compatible bases neuves & bases existantes (Idempotent: IF NOT EXISTS)
-- =========================================================================

-- -------------------------------------------------------------------------
-- ÉTAPE 1 : TABLE DES MAGASINS / DÉPÔTS (public.depots) & SÉCURISATION RLS
-- -------------------------------------------------------------------------
DO $$
BEGIN
  -- Si la table depots existe avec une colonne id de type integer/bigint, la convertir en TEXT
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'depots' AND column_name = 'id' AND data_type LIKE '%int%'
  ) THEN
    ALTER TABLE public.depots ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE public.depots ALTER COLUMN id TYPE TEXT USING id::text;
    ALTER TABLE public.depots ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.depots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id TEXT,
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  address TEXT,
  manager TEXT,
  phone TEXT,
  email TEXT,
  description TEXT,
  pickup_zones TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.depots 
  ADD COLUMN IF NOT EXISTS company_id TEXT,
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS manager TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS pickup_zones TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_depots_name ON public.depots(name);
CREATE INDEX IF NOT EXISTS idx_depots_company ON public.depots(company_id);

-- Activation RLS
ALTER TABLE public.depots ENABLE ROW LEVEL SECURITY;

-- Fonction RPC de vérification des permissions (Anti-tampering)
CREATE OR REPLACE FUNCTION public.check_user_depot_permission(
  p_depot_id TEXT,
  p_required_role INT DEFAULT 1 -- 0: Admin, 1: Manager, 2: Magasinier
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_role INT;
  v_allowed_depots TEXT[];
BEGIN
  -- Récupération du profil utilisateur lié à Supabase Auth
  SELECT role_id, allowed_depots 
  INTO v_user_role, v_allowed_depots
  FROM public.users
  WHERE auth_user_id = auth.uid() OR id::text = auth.uid()::text;

  -- SuperAdmin ou Administrateur Système (accès universel)
  IF v_user_role = 0 THEN
    RETURN TRUE;
  END IF;

  -- Vérification du niveau de rôle
  IF v_user_role IS NOT NULL AND v_user_role > p_required_role THEN
    RETURN FALSE;
  END IF;

  -- Vérification des dépôts autorisés
  IF v_allowed_depots IS NULL OR array_length(v_allowed_depots, 1) = 0 OR p_depot_id = ANY(v_allowed_depots) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- Politiques RLS dépôts
DROP POLICY IF EXISTS "Secure read depots" ON public.depots;
CREATE POLICY "Secure read depots"
  ON public.depots
  FOR SELECT
  TO authenticated, anon
  USING (
    is_active = true OR public.check_user_depot_permission(id, 1)
  );

DROP POLICY IF EXISTS "Secure write depots" ON public.depots;
CREATE POLICY "Secure write depots"
  ON public.depots
  FOR ALL
  TO authenticated
  USING (
    public.check_user_depot_permission(id, 1)
  )
  WITH CHECK (
    public.check_user_depot_permission(id, 1)
  );

-- Insertion du dépôt principal par défaut si aucun dépôt n'existe
INSERT INTO public.depots (id, name, code, address, description)
VALUES ('dep-01', 'Dépôt Principal', 'DEP-01', 'Siège / Entrepôt Central', 'Stock central outillage et consommables')
ON CONFLICT (name) DO NOTHING;

-- -------------------------------------------------------------------------
-- ÉTAPE 2 : DÉLÉGATION DE RETRAIT & CONTRÔLE SUR MATERIAL_ORDERS
-- -------------------------------------------------------------------------
ALTER TABLE public.material_orders 
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS pickup_zone TEXT,
  ADD COLUMN IF NOT EXISTS ready_qr_code TEXT,
  ADD COLUMN IF NOT EXISTS signature_data TEXT,
  ADD COLUMN IF NOT EXISTS proof_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pickup_delegate_id TEXT,
  ADD COLUMN IF NOT EXISTS pickup_delegate_name TEXT,
  ADD COLUMN IF NOT EXISTS pickup_delegate_department TEXT,
  ADD COLUMN IF NOT EXISTS pickup_delegate_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_delegate_by TEXT,
  ADD COLUMN IF NOT EXISTS pickup_delegate_notes TEXT;

-- Indexation spécifique pour les requêtes de commandes déléguées et tri actif
CREATE INDEX IF NOT EXISTS idx_material_orders_delegate ON public.material_orders (pickup_delegate_id);
CREATE INDEX IF NOT EXISTS idx_material_orders_depot ON public.material_orders (depot_name);
CREATE INDEX IF NOT EXISTS idx_material_orders_delegate_dept ON public.material_orders (pickup_delegate_department);

-- Compatibilité si table nommée "orders"
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'orders') THEN
    ALTER TABLE public.orders 
      ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS approved_by TEXT,
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS rejected_by TEXT,
      ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
      ADD COLUMN IF NOT EXISTS pickup_zone TEXT,
      ADD COLUMN IF NOT EXISTS ready_qr_code TEXT,
      ADD COLUMN IF NOT EXISTS signature_data TEXT,
      ADD COLUMN IF NOT EXISTS proof_photo_url TEXT,
      ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS pickup_delegate_id TEXT,
      ADD COLUMN IF NOT EXISTS pickup_delegate_name TEXT,
      ADD COLUMN IF NOT EXISTS pickup_delegate_department TEXT,
      ADD COLUMN IF NOT EXISTS pickup_delegate_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS pickup_delegate_by TEXT,
      ADD COLUMN IF NOT EXISTS pickup_delegate_notes TEXT;
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- ÉTAPE 3 : AUDIT TRAIL ET CONTRÔLE DES FLUX (audit_logs)
-- Cohérence complète avec le schéma original (colonnes type, category, depot_name, badge_text, etc.)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  type TEXT NOT NULL DEFAULT 'SYSTEM',
  category TEXT NOT NULL DEFAULT 'SYSTEM',
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
  badgeText TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  action TEXT,
  entity TEXT,
  entity_id TEXT,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS user_name TEXT,
  ADD COLUMN IF NOT EXISTS user_trigram TEXT,
  ADD COLUMN IF NOT EXISTS product_id TEXT,
  ADD COLUMN IF NOT EXISTS product_ref TEXT,
  ADD COLUMN IF NOT EXISTS quantity_changed INT,
  ADD COLUMN IF NOT EXISTS site_number TEXT,
  ADD COLUMN IF NOT EXISTS depot_name TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS badge_text TEXT,
  ADD COLUMN IF NOT EXISTS badgeText TEXT,
  ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS action TEXT,
  ADD COLUMN IF NOT EXISTS entity TEXT,
  ADD COLUMN IF NOT EXISTS entity_id TEXT,
  ADD COLUMN IF NOT EXISTS details JSONB,
  ADD COLUMN IF NOT EXISTS ip_address TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_created_at ON public.audit_logs (created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read audit_logs" ON public.audit_logs;
CREATE POLICY "Allow read audit_logs" ON public.audit_logs 
  FOR SELECT TO authenticated 
  USING (true);

DROP POLICY IF EXISTS "Allow insert audit_logs" ON public.audit_logs;
CREATE POLICY "Allow insert audit_logs" ON public.audit_logs 
  FOR INSERT TO authenticated 
  WITH CHECK (true);

-- -------------------------------------------------------------------------
-- FIN DE LA MIGRATION PHASE 1
-- -------------------------------------------------------------------------
