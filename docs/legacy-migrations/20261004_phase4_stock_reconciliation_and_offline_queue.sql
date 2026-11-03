-- =========================================================================
-- TOT STOCK PRO v5.5 - MIGRATION PHASE 4 : RÉCONCILIATION, FILE HORS-LIGNE & CLÔTURE ERP
-- Version : 5.5 - Phase 4
-- Compatible bases neuves & bases existantes (Idempotent: IF NOT EXISTS)
-- =========================================================================

-- -------------------------------------------------------------------------
-- ÉTAPE 1 : TABLE DE RÉCONCILIATION ET CORRECTION DES DÉRIVES DE STOCK
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_reconciliations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_ref TEXT NOT NULL,
  depot_name TEXT,
  previous_quantity NUMERIC(10,2) NOT NULL,
  calculated_quantity NUMERIC(10,2) NOT NULL,
  delta NUMERIC(10,2) NOT NULL,
  reason TEXT NOT NULL DEFAULT 'RECALCULATION_MOUVEMENTS',
  reconciled_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconcil_product ON public.stock_reconciliations (product_id);
CREATE INDEX IF NOT EXISTS idx_reconcil_created ON public.stock_reconciliations (created_at DESC);

ALTER TABLE public.stock_reconciliations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read stock_reconciliations" ON public.stock_reconciliations;
CREATE POLICY "Allow read stock_reconciliations" ON public.stock_reconciliations FOR SELECT TO authenticated, anon USING (true);
DROP POLICY IF EXISTS "Allow write stock_reconciliations" ON public.stock_reconciliations;
CREATE POLICY "Allow write stock_reconciliations" ON public.stock_reconciliations FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

-- -------------------------------------------------------------------------
-- ÉTAPE 2 : FONCTION RPC DE RÉCONCILIATION AUTOMATIQUE DES STOCKS
-- Recalcule la quantité exacte d'un produit ou de tout le catalogue d'après ses mouvements
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_single_product_stock(
  p_product_id TEXT,
  p_reconciled_by TEXT DEFAULT 'SYSTÈME'
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_in NUMERIC;
  v_out NUMERIC;
  v_real_qty NUMERIC;
  v_prev_qty NUMERIC;
  v_ref TEXT;
  v_depot TEXT;
BEGIN
  -- Récupérer la référence et la quantité actuelle
  SELECT reference, quantity, store_name 
  INTO v_ref, v_prev_qty, v_depot
  FROM public.products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Calculer les entrées et sorties
  SELECT COALESCE(SUM(quantity_changed), 0) INTO v_in
  FROM public.stock_movements
  WHERE product_id = p_product_id AND movement_type = 'IN';

  SELECT COALESCE(SUM(quantity_changed), 0) INTO v_out
  FROM public.stock_movements
  WHERE product_id = p_product_id AND movement_type = 'OUT';

  v_real_qty := GREATEST(0, v_in - v_out);

  -- Si un écart existe, mettre à jour le produit et consigner la réconciliation
  IF v_prev_qty <> v_real_qty THEN
    UPDATE public.products
    SET quantity = v_real_qty, updated_at = now()
    WHERE id = p_product_id;

    INSERT INTO public.stock_reconciliations (
      id, product_id, product_ref, depot_name,
      previous_quantity, calculated_quantity, delta,
      reason, reconciled_by
    )
    VALUES (
      'rec-' || extract(epoch from now())::text || '-' || substr(md5(random()::text), 1, 4),
      p_product_id, v_ref, v_depot,
      v_prev_qty, v_real_qty, (v_real_qty - v_prev_qty),
      'Alignement sur historique des mouvements', p_reconciled_by
    );
  END IF;

  RETURN v_real_qty;
END;
$$;

-- -------------------------------------------------------------------------
-- ÉTAPE 3 : TABLE DE LA FILE D'ATTENTE HORS-LIGNE (offline_sync_queue)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offline_sync_queue (
  id TEXT PRIMARY KEY,
  device_id TEXT,
  user_id TEXT,
  user_name TEXT,
  action_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSED', 'CONFLICT', 'ERROR')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offline_sync_status ON public.offline_sync_queue (status);
CREATE INDEX IF NOT EXISTS idx_offline_sync_captured ON public.offline_sync_queue (captured_at ASC);

ALTER TABLE public.offline_sync_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read offline_sync_queue" ON public.offline_sync_queue;
CREATE POLICY "Allow read offline_sync_queue" ON public.offline_sync_queue FOR SELECT TO authenticated, anon USING (true);
DROP POLICY IF EXISTS "Allow write offline_sync_queue" ON public.offline_sync_queue;
CREATE POLICY "Allow write offline_sync_queue" ON public.offline_sync_queue FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

-- -------------------------------------------------------------------------
-- ÉTAPE 4 : TABLE DE CLÔTURE COMPTABLE & VALORISATION DU STOCK (financial_inventory_closures)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_inventory_closures (
  id TEXT PRIMARY KEY,
  closure_code TEXT NOT NULL UNIQUE,
  period_label TEXT NOT NULL,
  depot_name TEXT,
  total_references INT NOT NULL DEFAULT 0,
  total_units NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_stock_value_ht NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  closed_by_user TEXT NOT NULL,
  is_locked BOOLEAN NOT NULL DEFAULT true,
  export_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_closures_created ON public.financial_inventory_closures (created_at DESC);

ALTER TABLE public.financial_inventory_closures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read financial_inventory_closures" ON public.financial_inventory_closures;
CREATE POLICY "Allow read financial_inventory_closures" ON public.financial_inventory_closures FOR SELECT TO authenticated, anon USING (true);
DROP POLICY IF EXISTS "Allow write financial_inventory_closures" ON public.financial_inventory_closures;
CREATE POLICY "Allow write financial_inventory_closures" ON public.financial_inventory_closures FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

-- -------------------------------------------------------------------------
-- FIN DE LA MIGRATION PHASE 4
-- -------------------------------------------------------------------------
