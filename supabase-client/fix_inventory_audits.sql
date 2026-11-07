-- =========================================================================
-- TOT STOCK - CORRECTIF AUTONOME & IDEMPOTENT : HISTORIQUE DES AUDITS D'INVENTAIRE
-- Fichier : supabase-client/fix_inventory_audits.sql
-- Intégré également dans : supabase-client/04_mouvements_et_depots_vehicules.sql
--
-- Objectifs :
-- 1. Renommer inventory_audits -> stk_inventory_audits et inventory_audit_items -> stk_inventory_audit_items
--    si les anciens noms physiques existent encore.
-- 2. Créer idempotemment public.stk_inventory_audits et public.stk_inventory_audit_items
--    avec toutes leurs colonnes et index.
-- 3. Activer RLS, révoquer tout accès anon/PUBLIC, et installer les règles RLS strictes :
--    - SELECT / INSERT : rôle 0 ou perm_menu_inventory_audit ou perm_inventory_validate
--    - UPDATE / DELETE : rôle 0 uniquement
--    - anon : zéro accès
-- =========================================================================

-- 1. Renommage défensif des anciens noms de tables si présents sous forme de table physique
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

-- 2. Création idempotente de public.stk_inventory_audits & colonnes additives
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

-- 3. Création idempotente de public.stk_inventory_audit_items & colonnes additives
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

-- 4. Droits & Règles RLS sur stk_inventory_audits et stk_inventory_audit_items
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

-- Règles sur public.stk_inventory_audits :
-- SELECT / INSERT : rôle 0 ou perm_menu_inventory_audit ou perm_inventory_validate
-- UPDATE / DELETE : rôle 0 uniquement
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

-- Règles sur public.stk_inventory_audit_items :
-- SELECT / INSERT : rôle 0 ou perm_menu_inventory_audit ou perm_inventory_validate
-- UPDATE / DELETE : rôle 0 uniquement
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
