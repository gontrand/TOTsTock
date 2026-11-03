-- =========================================================================
-- TOT STOCK PRO - MIGRATION : VALIDATION DES COMMANDES & WORKFLOW DÉBRAYABLE
-- Version : 5.5
-- Compatible avec toutes les bases existantes (Idempotent: IF NOT EXISTS)
-- =========================================================================

-- 1. Ajout des options de validation hiérarchique sur les départements
ALTER TABLE public.departments 
  ADD COLUMN IF NOT EXISTS require_order_approval BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS order_approval_threshold NUMERIC(10,2) DEFAULT 0;

-- 2. Ajout des champs de montant et validation sur la table material_orders
ALTER TABLE public.material_orders 
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- 3. Mise à jour de la contrainte CHECK de status pour supporter WAITING_APPROVAL et REJECTED
DO $$ 
BEGIN 
  ALTER TABLE public.material_orders DROP CONSTRAINT IF EXISTS material_orders_status_check;
  ALTER TABLE public.material_orders ADD CONSTRAINT material_orders_status_check 
    CHECK (status IN ('WAITING_APPROVAL', 'PENDING', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED', 'REJECTED'));
EXCEPTION WHEN OTHERS THEN 
  NULL;
END $$;

-- 4. Index de performance pour les requêtes sur les commandes en attente
CREATE INDEX IF NOT EXISTS idx_dep_approval ON public.departments (require_order_approval);
CREATE INDEX IF NOT EXISTS idx_material_orders_status ON public.material_orders (status);
CREATE INDEX IF NOT EXISTS idx_material_orders_cost ON public.material_orders (total_cost);

-- 5. Compatibilité si la table s'appelle "orders"
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'orders') THEN
    ALTER TABLE public.orders 
      ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS approved_by TEXT,
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS rejected_by TEXT,
      ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
  END IF;
END $$;
