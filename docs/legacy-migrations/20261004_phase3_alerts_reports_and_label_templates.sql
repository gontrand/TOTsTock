-- =========================================================================
-- TOT STOCK PRO v5.5 - MIGRATION PHASE 3 : AUTOMATISATION DES RAPPORTS, ALERTES & MODÈLES D'ÉTIQUETTES
-- Version : 5.5 - Phase 3
-- Compatible bases neuves & bases existantes (Idempotent: IF NOT EXISTS)
-- =========================================================================

-- -------------------------------------------------------------------------
-- ÉTAPE 1 : TABLE DES RAPPORTS PROGRAMMÉS PAR EMAIL (scheduled_reports)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scheduled_reports (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('LOW_STOCK', 'WEEKLY_RECAP', 'INVENTORY_AUDIT', 'PROJECT_OUTFLOW', 'CUSTOM')),
  frequency TEXT NOT NULL DEFAULT 'WEEKLY' CHECK (frequency IN ('DAILY', 'WEEKLY', 'MONTHLY', 'INSTANT_ALERT')),
  recipients TEXT[] NOT NULL DEFAULT '{}',
  depot_name TEXT,
  is_active BOOLEAN DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_type ON public.scheduled_reports (report_type);
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_active ON public.scheduled_reports (is_active);

ALTER TABLE public.scheduled_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read scheduled_reports" ON public.scheduled_reports;
DROP POLICY IF EXISTS "Allow write scheduled_reports" ON public.scheduled_reports;
CREATE POLICY "Authenticated read scheduled_reports" ON public.scheduled_reports 
  FOR SELECT TO authenticated 
  USING (true);
CREATE POLICY "Admin write scheduled_reports" ON public.scheduled_reports 
  FOR ALL TO authenticated 
  USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_config_email')) 
  WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_config_email'));

-- -------------------------------------------------------------------------
-- ÉTAPE 2 : TABLE DU JOURNAL DES ALERTES DE STOCK CRITIQUE (stock_alerts_log)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_alerts_log (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  product_ref TEXT NOT NULL,
  product_name TEXT,
  depot_name TEXT,
  current_quantity NUMERIC(10,2) NOT NULL,
  min_threshold NUMERIC(10,2) NOT NULL,
  severity TEXT NOT NULL DEFAULT 'WARNING' CHECK (severity IN ('CRITICAL_OUT_OF_STOCK', 'WARNING_LOW_STOCK')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ORDERED', 'RESOLVED')),
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_alerts_product ON public.stock_alerts_log (product_id);
CREATE INDEX IF NOT EXISTS idx_stock_alerts_status ON public.stock_alerts_log (status);
CREATE INDEX IF NOT EXISTS idx_stock_alerts_created ON public.stock_alerts_log (created_at DESC);

ALTER TABLE public.stock_alerts_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read stock_alerts_log" ON public.stock_alerts_log;
DROP POLICY IF EXISTS "Allow write stock_alerts_log" ON public.stock_alerts_log;
CREATE POLICY "Authenticated read stock_alerts_log" ON public.stock_alerts_log 
  FOR SELECT TO authenticated 
  USING (true);

-- -------------------------------------------------------------------------
-- ÉTAPE 3 : TABLE DES MODÈLES D'ÉTIQUETTES THERMIQUES & CASIERS (label_templates)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.label_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  format_key TEXT NOT NULL UNIQUE,
  width_mm NUMERIC(6,2) NOT NULL DEFAULT 70.0,
  height_mm NUMERIC(6,2) NOT NULL DEFAULT 37.0,
  show_qr BOOLEAN DEFAULT true,
  show_barcode BOOLEAN DEFAULT true,
  show_location BOOLEAN DEFAULT true,
  show_price BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.label_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read label_templates" ON public.label_templates;
DROP POLICY IF EXISTS "Allow write label_templates" ON public.label_templates;
CREATE POLICY "Authenticated read label_templates" ON public.label_templates 
  FOR SELECT TO authenticated 
  USING (true);

-- Modèles standards pré-insérés
INSERT INTO public.label_templates (id, name, format_key, width_mm, height_mm, is_default)
VALUES 
  ('tpl-avery-3x8', 'Planche A4 Avery 3x8 (24 étiquettes 70x37mm)', 'avery_3x8', 70.0, 37.0, true),
  ('tpl-avery-2x7', 'Planche A4 Avery 2x7 (14 grandes étiquettes 105x42mm)', 'avery_2x7', 105.0, 42.0, false),
  ('tpl-thermal-roll', 'Imprimante Thermique Rouleau (50x30mm)', 'thermal', 50.0, 30.0, false),
  ('tpl-bin-rack', 'Étiquettes Casiers & Bacs de Retrait (Grande visibilité)', 'bin_rack', 90.0, 50.0, false)
ON CONFLICT (format_key) DO NOTHING;

-- -------------------------------------------------------------------------
-- FIN DE LA MIGRATION PHASE 3
-- -------------------------------------------------------------------------
