-- =========================================================================
-- SCHÉMA BASE MAÎTRE TOT STOCK (Projet Supabase Central / Licences Éditeur)
-- À exécuter UNIQUEMENT sur le projet Supabase Éditeur (Maître)
-- =========================================================================

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

-- 2. Table centrale des Licences (accès strictement réservé à service_role)
CREATE TABLE IF NOT EXISTS public."APP_TOT-Stock-licenses" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key TEXT NOT NULL,
  plan_type TEXT NOT NULL DEFAULT 'free',
  modules TEXT[] NOT NULL DEFAULT ARRAY['stock']::TEXT[],
  max_depots INT NOT NULL DEFAULT 1,
  organization_name TEXT NOT NULL DEFAULT 'Organisation Locale',
  contact_email TEXT,
  client_supabase_url TEXT DEFAULT '',
  binding_allowed BOOLEAN NOT NULL DEFAULT false,
  bound_at TIMESTAMPTZ,
  bound_by TEXT,
  billing_cycle TEXT DEFAULT 'annual',
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Évolutions additives et idempotentes du schéma maître :
ALTER TABLE public."APP_TOT-Stock-licenses" ALTER COLUMN client_supabase_url DROP NOT NULL;
ALTER TABLE public."APP_TOT-Stock-licenses" ALTER COLUMN client_supabase_url SET DEFAULT '';
ALTER TABLE public."APP_TOT-Stock-licenses"
  ADD COLUMN IF NOT EXISTS modules TEXT[] NOT NULL DEFAULT ARRAY['stock']::TEXT[],
  ADD COLUMN IF NOT EXISTS binding_allowed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bound_by TEXT;

-- Conversion automatique des alias vers les codes canoniques (artisan, starter, standard -> sta ; pme, professionnel -> pro ; enterprise, entreprise -> ent)
UPDATE public."APP_TOT-Stock-licenses"
SET plan_type = CASE
    WHEN LOWER(TRIM(plan_type)) IN ('artisan', 'standard', 'starter') THEN 'sta'
    WHEN LOWER(TRIM(plan_type)) IN ('pme', 'professionnel') THEN 'pro'
    WHEN LOWER(TRIM(plan_type)) IN ('enterprise', 'entreprise') THEN 'ent'
    ELSE LOWER(TRIM(plan_type))
  END,
  modules = COALESCE(NULLIF(modules, '{}'::TEXT[]), ARRAY['stock']::TEXT[])
WHERE LOWER(TRIM(plan_type)) IN ('artisan', 'standard', 'starter', 'pme', 'professionnel', 'enterprise', 'entreprise');

-- Index unique et d'optimisation
CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_unique_key ON public."APP_TOT-Stock-licenses" (UPPER(license_key));
CREATE INDEX IF NOT EXISTS idx_licenses_url ON public."APP_TOT-Stock-licenses" (client_supabase_url);
CREATE INDEX IF NOT EXISTS idx_licenses_active ON public."APP_TOT-Stock-licenses" (is_active);
CREATE INDEX IF NOT EXISTS idx_licenses_org ON public."APP_TOT-Stock-licenses" (organization_name);

-- 3. Sécurité RLS et verrouillage total pour anon et authenticated
-- Aucune politique pour anon ni authenticated : seul le service_role (Edge Functions) y accède.
ALTER TABLE public."APP_TOT-Stock-licenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."APP_TOT-Stock-licenses" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read licenses" ON public."APP_TOT-Stock-licenses";
DROP POLICY IF EXISTS "Allow anon read licenses" ON public."APP_TOT-Stock-licenses";
DROP POLICY IF EXISTS "Allow anon insert licenses" ON public."APP_TOT-Stock-licenses";
DROP POLICY IF EXISTS "Allow anon update licenses" ON public."APP_TOT-Stock-licenses";
DROP POLICY IF EXISTS "Allow anon delete licenses" ON public."APP_TOT-Stock-licenses";
DROP POLICY IF EXISTS "Allow anon read active licenses" ON public."APP_TOT-Stock-licenses";

REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public."APP_TOT-Stock-licenses" FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public."APP_TOT-Stock-licenses" TO service_role;

-- 4. Journal d'audit des liaisons et table de notifications éditeur (service_role uniquement)
CREATE TABLE IF NOT EXISTS public.master_license_binding_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id UUID REFERENCES public."APP_TOT-Stock-licenses"(id) ON DELETE CASCADE,
  license_key TEXT NOT NULL,
  action_type TEXT NOT NULL, -- 'FIRST_BINDING', 'ADMIN_REBIND', 'REBIND_REJECTED', 'FIRST_BINDING_REJECTED'
  previous_url TEXT,
  new_url TEXT,
  performed_by TEXT NOT NULL,
  client_ip TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.master_license_binding_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_license_binding_logs FORCE ROW LEVEL SECURITY;
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.master_license_binding_logs FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.master_license_binding_logs TO service_role;

CREATE TABLE IF NOT EXISTS public.master_vendor_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  license_key TEXT NOT NULL,
  organization_name TEXT,
  client_supabase_url TEXT,
  previous_url TEXT,
  performed_by TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.master_vendor_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_vendor_notifications FORCE ROW LEVEL SECURITY;
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.master_vendor_notifications FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.master_vendor_notifications TO service_role;

-- 5. Fonction RPC isolée : chaque client ne peut vérifier QUE sa propre licence en fournissant
-- OBLIGATOIREMENT la clé de licence ET l'adresse de son projet Supabase lié.
DROP FUNCTION IF EXISTS public.verify_client_license(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.verify_client_license(TEXT);
DROP FUNCTION IF EXISTS public.verify_client_license;

CREATE OR REPLACE FUNCTION public.verify_client_license(
  p_license_key TEXT,
  p_client_supabase_url TEXT
)
RETURNS TABLE (
  id UUID,
  license_key TEXT,
  plan_type TEXT,
  modules TEXT[],
  max_depots INT,
  organization_name TEXT,
  client_supabase_url TEXT,
  contact_email TEXT,
  billing_cycle TEXT,
  binding_allowed BOOLEAN,
  is_active BOOLEAN,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref TEXT;
BEGIN
  IF p_license_key IS NULL OR TRIM(p_license_key) = '' OR p_client_supabase_url IS NULL OR TRIM(p_client_supabase_url) = '' THEN
    RETURN;
  END IF;

  -- Extraction du project_ref de l'URL cliente (ex: https://xyz.supabase.co -> xyz)
  v_ref := LOWER(TRIM(p_client_supabase_url));
  IF v_ref LIKE '%.supabase.co%' THEN
    v_ref := split_part(split_part(v_ref, '://', 2), '.', 1);
  END IF;

  RETURN QUERY
  SELECT 
    l.id,
    l.license_key,
    CASE
      WHEN LOWER(TRIM(l.plan_type)) IN ('sta', 'artisan', 'standard', 'starter') THEN 'sta'
      WHEN LOWER(TRIM(l.plan_type)) IN ('pro', 'pme', 'professionnel') THEN 'pro'
      WHEN LOWER(TRIM(l.plan_type)) IN ('ent', 'enterprise', 'entreprise') THEN 'ent'
      ELSE LOWER(TRIM(l.plan_type))
    END AS plan_type,
    COALESCE(NULLIF(l.modules, '{}'::TEXT[]), ARRAY['stock']::TEXT[]) AS modules,
    l.max_depots,
    l.organization_name,
    l.client_supabase_url,
    l.contact_email,
    l.billing_cycle,
    l.binding_allowed,
    l.is_active,
    l.expires_at,
    l.created_at
  FROM public."APP_TOT-Stock-licenses" l
  WHERE UPPER(TRIM(l.license_key)) = UPPER(TRIM(p_license_key))
    AND l.client_supabase_url IS NOT NULL
    AND TRIM(l.client_supabase_url) <> ''
    AND (
      LOWER(TRIM(l.client_supabase_url)) = LOWER(TRIM(p_client_supabase_url))
      OR (v_ref <> '' AND LOWER(l.client_supabase_url) LIKE '%' || v_ref || '%')
    )
    AND l.is_active = true
    AND (l.expires_at IS NULL OR l.expires_at > now())
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_client_license(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_client_license(TEXT, TEXT) TO anon, authenticated, service_role;

-- Trigger de mise à jour automatique de updated_at
CREATE OR REPLACE FUNCTION public.fn_licenses_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_licenses_updated_at ON public."APP_TOT-Stock-licenses";
CREATE TRIGGER trg_licenses_updated_at
  BEFORE UPDATE ON public."APP_TOT-Stock-licenses"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_licenses_touch_updated_at();

-- -------------------------------------------------------------------------
-- 6. TABLE DE RATE LIMITING POUR LES EDGE FUNCTIONS MAÎTRE
-- Accessible UNIQUEMENT par le service_role (RLS activée, aucune policy anon/auth)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.master_rate_limits (
  identifier TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INT NOT NULL DEFAULT 1,
  PRIMARY KEY (identifier, window_start)
);

ALTER TABLE public.master_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_rate_limits FORCE ROW LEVEL SECURITY;
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.master_rate_limits FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.master_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_identifier TEXT,
  p_window_seconds INT DEFAULT 60,
  p_max_requests INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count INT;
  v_allowed BOOLEAN;
BEGIN
  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO public.master_rate_limits (identifier, window_start, request_count)
  VALUES (p_identifier, v_window_start, 1)
  ON CONFLICT (identifier, window_start)
  DO UPDATE SET request_count = public.master_rate_limits.request_count + 1
  RETURNING request_count INTO v_count;

  -- Purge des fenêtres expirées de plus de 1 heure
  IF random() < 0.1 THEN
    DELETE FROM public.master_rate_limits WHERE window_start < now() - INTERVAL '1 hour';
  END IF;

  v_allowed := (v_count <= p_max_requests);

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'current_count', v_count,
    'max_requests', p_max_requests,
    'window_seconds', p_window_seconds
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INT, INT) TO service_role;
