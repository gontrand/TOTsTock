-- =========================================================================
-- TOT STOCK PRO v5.5 - MIGRATION PHASE 4 : CONTRÔLE DES QUOTAS DE LICENCE CÔTÉ BASE DE DONNÉES
-- Version : 5.5 - Phase 4 (Licences & Quotas Inviolables via plan_limits(plan))
-- Compatible bases neuves & bases existantes (Idempotent: IF NOT EXISTS)
-- =========================================================================

-- -------------------------------------------------------------------------
-- ÉTAPE 0 : FONCTION UNIQUE DE PLAFONDS TECHNIQUES PAR FORMULE (plan_limits)
-- Jamais stockés par client dans la table ou le jeton
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.plan_limits(p_plan TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_norm TEXT := LOWER(TRIM(COALESCE(p_plan, 'free')));
BEGIN
  IF v_norm IN ('sta', 'standard', 'artisan') THEN
    RETURN jsonb_build_object(
      'plan', 'artisan',
      'max_references', 250,
      'max_depots', 1,
      'max_users', 5,
      'default_modules', to_jsonb(ARRAY['stock']::TEXT[])
    );
  ELSIF v_norm IN ('pro', 'pme') THEN
    RETURN jsonb_build_object(
      'plan', 'pme',
      'max_references', 2000,
      'max_depots', 3,
      'max_users', 25,
      'default_modules', to_jsonb(ARRAY['stock', 'outils', 'rapports']::TEXT[])
    );
  ELSIF v_norm IN ('ent', 'enterprise', 'entreprise') THEN
    RETURN jsonb_build_object(
      'plan', 'enterprise',
      'max_references', 99999,
      'max_depots', 99999,
      'max_users', 99999,
      'default_modules', to_jsonb(ARRAY['stock', 'outils', 'formation', 'rapports']::TEXT[])
    );
  ELSE
    RETURN jsonb_build_object(
      'plan', 'free',
      'max_references', 30,
      'max_depots', 1,
      'max_users', 2,
      'default_modules', to_jsonb(ARRAY['stock']::TEXT[])
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.plan_limits(TEXT) TO anon, authenticated, service_role;

-- -------------------------------------------------------------------------
-- ÉTAPE 1 : TABLE DE CONFIGURATION DE LA LICENCE CLIENT (license_config)
-- (max_references et max_tools sont retirés ; modules et max_depots conservés)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.license_config (
  id TEXT PRIMARY KEY DEFAULT 'active_license',
  license_key TEXT NOT NULL,
  plan_type TEXT NOT NULL DEFAULT 'free',
  modules TEXT[] NOT NULL DEFAULT ARRAY['stock']::TEXT[],
  max_depots INT NOT NULL DEFAULT 1,
  organization_name TEXT,
  signed_token TEXT,
  offline_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.license_config
  ADD COLUMN IF NOT EXISTS modules TEXT[] DEFAULT ARRAY['stock']::TEXT[],
  DROP COLUMN IF EXISTS max_references,
  DROP COLUMN IF EXISTS max_tools;

ALTER TABLE public.license_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read license_config" ON public.license_config;
DROP POLICY IF EXISTS "Allow write license_config" ON public.license_config;
DROP POLICY IF EXISTS "Authenticated read license_config" ON public.license_config;
DROP POLICY IF EXISTS "Authenticated write license_config" ON public.license_config;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.license_config FROM anon, authenticated, PUBLIC;

CREATE POLICY "Authenticated read license_config" ON public.license_config 
  FOR SELECT TO authenticated 
  USING (true);

-- Initialisation par défaut (Forfait Gratuit / Free Tier)
INSERT INTO public.license_config (id, license_key, plan_type, modules, max_depots, organization_name)
VALUES ('active_license', 'TOT-STOCK-FREE-INITIAL', 'free', ARRAY['stock']::TEXT[], 1, 'Organisation Locale')
ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------------------------
-- ÉTAPE 2 : TRIGGER POSTGRESQL DE CONTRÔLE STRICT DU QUOTA DE RÉFÉRENCES
-- Plafond calculé dynamiquement via public.plan_limits(plan_type)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_license_max_references_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count INT;
  v_max_references INT := 30;
  v_plan_type TEXT := 'free';
  v_limits JSONB;
BEGIN
  BEGIN
    SELECT LOWER(COALESCE(plan_type, 'free'))
    INTO v_plan_type
    FROM public.license_config
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_plan_type := 'free';
  END;

  v_limits := public.plan_limits(v_plan_type);
  v_plan_type := COALESCE(v_limits->>'plan', 'free');
  v_max_references := COALESCE((v_limits->>'max_references')::int, 30);

  IF v_max_references IS NULL OR v_max_references <= 0 THEN
    v_max_references := 30;
  END IF;

  -- Si forfait Entreprise (illimité), autoriser sans restriction
  IF v_max_references >= 99999 THEN
    RETURN NEW;
  END IF;

  -- Compter le nombre actuel d'articles existants
  SELECT COUNT(*) INTO v_current_count
  FROM public.products;

  -- Vérification stricte du quota
  IF v_current_count >= v_max_references THEN
    RAISE EXCEPTION 'QUOTA_EXCEEDED: Votre licence TOT Stock (%) est limitée à % références maximum. Vous avez actuellement % références enregistrées. Veuillez mettre à niveau votre forfait (Artisan, PME ou Entreprise).',
      UPPER(COALESCE(v_plan_type, 'FREE')), v_max_references, v_current_count;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_license_max_references ON public.products;
CREATE TRIGGER trg_enforce_license_max_references
  BEFORE INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_license_max_references_quota();

-- -------------------------------------------------------------------------
-- ÉTAPE 3 : TRIGGER POSTGRESQL DE CONTRÔLE STRICT DU QUOTA DE DÉPÔTS (max_depots)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_license_max_depots_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count INT;
  v_max_depots INT := 1;
  v_plan_type TEXT := 'free';
  v_limits JSONB;
BEGIN
  SELECT max_depots, LOWER(COALESCE(plan_type, 'free'))
  INTO v_max_depots, v_plan_type
  FROM public.license_config
  LIMIT 1;

  v_limits := public.plan_limits(v_plan_type);
  v_plan_type := COALESCE(v_limits->>'plan', 'free');

  IF v_max_depots IS NULL OR v_max_depots <= 0 THEN
    v_max_depots := COALESCE((v_limits->>'max_depots')::int, 1);
  END IF;

  IF v_max_depots >= 99999 THEN
    RETURN NEW;
  END IF;

  -- Compter le nombre de dépôts actifs existants
  SELECT COUNT(*) INTO v_current_count
  FROM public.depots
  WHERE is_active = true;

  IF v_current_count >= v_max_depots THEN
    RAISE EXCEPTION 'QUOTA_EXCEEDED: Votre licence TOT Stock (%) est limitée à % magasin(s)/dépôt(s) maximum. Veuillez mettre à niveau votre forfait.',
      UPPER(COALESCE(v_plan_type, 'FREE')), v_max_depots;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_license_max_depots ON public.depots;
CREATE TRIGGER trg_enforce_license_max_depots
  BEFORE INSERT ON public.depots
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_license_max_depots_quota();
