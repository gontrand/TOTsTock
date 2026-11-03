-- =========================================================================
-- TOT STOCK PRO v5.5 - MIGRATION PHASE 2 : TRAÇABILITÉ PRÉPARATIONS, ZONES & AUDITS INVENTAIRES
-- Version : 5.5 - Phase 2
-- Compatible bases neuves & bases existantes (Idempotent: IF NOT EXISTS)
-- =========================================================================

-- -------------------------------------------------------------------------
-- ÉTAPE 1 : ZONES DE RETRAIT & CASIERS CONFIGURABLES PAR DÉPÔT
-- -------------------------------------------------------------------------
ALTER TABLE public.depots 
  ADD COLUMN IF NOT EXISTS pickup_zones TEXT[] DEFAULT '{"Casier A1", "Casier A2", "Zone Drive Magasin", "Étagère Retrait 1"}';

-- -------------------------------------------------------------------------
-- ÉTAPE 2 : TABLE DES SESSIONS D'INVENTAIRE PHYSIQUE (inventory_audits)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_audits (
  id TEXT PRIMARY KEY,
  depot_name TEXT,
  auditor_id TEXT,
  auditor_name TEXT,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  items_counted INT NOT NULL DEFAULT 0,
  items_with_diff INT NOT NULL DEFAULT 0,
  total_diff_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  audit_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_audits_depot ON public.inventory_audits (depot_name);
CREATE INDEX IF NOT EXISTS idx_inventory_audits_created ON public.inventory_audits (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_audits_auditor ON public.inventory_audits (auditor_id);

ALTER TABLE public.inventory_audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read inventory_audits" ON public.inventory_audits;
DROP POLICY IF EXISTS "Allow write inventory_audits" ON public.inventory_audits;
CREATE POLICY "Authenticated read inventory_audits" ON public.inventory_audits 
  FOR SELECT TO authenticated 
  USING (true);
CREATE POLICY "Authenticated write inventory_audits" ON public.inventory_audits 
  FOR ALL TO authenticated 
  USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_menu_inventory_audit')) 
  WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_menu_inventory_audit'));

-- -------------------------------------------------------------------------
-- ÉTAPE 3 : DÉTAIL PAR ARTICLE DE L'INVENTAIRE (inventory_audit_items)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_audit_items (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL REFERENCES public.inventory_audits(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_ref TEXT NOT NULL,
  product_name TEXT,
  theoretical_qty NUMERIC(10,2) NOT NULL,
  physical_count NUMERIC(10,2) NOT NULL,
  difference NUMERIC(10,2) NOT NULL,
  unit_price NUMERIC(10,2) DEFAULT 0,
  diff_cost NUMERIC(10,2) DEFAULT 0,
  scanned_barcode TEXT,
  scanned_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_items_audit_id ON public.inventory_audit_items (audit_id);
CREATE INDEX IF NOT EXISTS idx_audit_items_product_id ON public.inventory_audit_items (product_id);
CREATE INDEX IF NOT EXISTS idx_audit_items_ref ON public.inventory_audit_items (product_ref);

ALTER TABLE public.inventory_audit_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read inventory_audit_items" ON public.inventory_audit_items;
DROP POLICY IF EXISTS "Allow write inventory_audit_items" ON public.inventory_audit_items;
CREATE POLICY "Authenticated read inventory_audit_items" ON public.inventory_audit_items 
  FOR SELECT TO authenticated 
  USING (true);
CREATE POLICY "Authenticated write inventory_audit_items" ON public.inventory_audit_items 
  FOR ALL TO authenticated 
  USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_menu_inventory_audit')) 
  WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_menu_inventory_audit'));

-- -------------------------------------------------------------------------
-- ÉTAPE 4 : JOURNAL DES SCANS & POINTAGES DE PRÉPARATION (order_preparations_log)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_preparations_log (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_ref TEXT NOT NULL,
  preparer_id TEXT,
  preparer_name TEXT,
  picked_quantity NUMERIC(10,2) NOT NULL,
  scanned_barcode TEXT,
  pickup_zone TEXT,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_prep_order ON public.order_preparations_log (order_id);
CREATE INDEX IF NOT EXISTS idx_order_prep_number ON public.order_preparations_log (order_number);
CREATE INDEX IF NOT EXISTS idx_order_prep_preparer ON public.order_preparations_log (preparer_id);
CREATE INDEX IF NOT EXISTS idx_order_prep_scanned_at ON public.order_preparations_log (scanned_at DESC);

ALTER TABLE public.order_preparations_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read order_preparations_log" ON public.order_preparations_log;
DROP POLICY IF EXISTS "Allow write order_preparations_log" ON public.order_preparations_log;
CREATE POLICY "Authenticated read order_preparations_log" ON public.order_preparations_log 
  FOR SELECT TO authenticated 
  USING (true);
CREATE POLICY "Authenticated write order_preparations_log" ON public.order_preparations_log 
  FOR INSERT TO authenticated 
  WITH CHECK (preparer_id = public.current_user_id() OR public.current_user_role() = 0);

-- -------------------------------------------------------------------------
-- FIN DE LA MIGRATION PHASE 2
-- -------------------------------------------------------------------------
