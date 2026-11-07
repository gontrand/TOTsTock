-- =========================================================================
-- TOT STOCK - SCRIPT 01 : AUTH LINK (01_auth_link.sql)
-- Description : Liaison entre Supabase Auth (auth.users) et les profils métier (public.core_users)
-- Dépendances : auth.users (Supabase Auth), 00_complete_tot_stock_schema.sql / 09_core_prefixes.sql
-- Rejouable : oui (idempotent)
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. VÉRIFICATION DES PRÉREQUIS (Point 3)
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'auth' AND table_name = 'users'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (01_auth_link.sql) : La table auth.users de Supabase Auth est introuvable.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'core_users'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (01_auth_link.sql) : La table public.core_users est absente. Exécutez d''abord le schéma de base (00_complete_tot_stock_schema.sql ou 09_core_prefixes.sql).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'core_users' AND column_name = 'email'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (01_auth_link.sql) : La colonne public.core_users.email est absente.';
  END IF;
END $$;

-- 1. Harmonisation de la table public.core_users et de public.core_audit_logs :
--    - Rendre 'pin' et 'pin_hash' optionnels (NULL) pour l'authentification Auth
--    - Assurer les colonnes d'audit (app, action, severity, details) sur public.core_audit_logs
--    - Nettoyer UNIQUEMENT les triggers obsolètes explicitement nommés et justifiés
DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_users_enforce_pin ON public.core_users;
  DROP TRIGGER IF EXISTS trg_sync_user_to_auth ON public.core_users;
  DROP TRIGGER IF EXISTS trg_users_auto_id_int ON public.core_users;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'core_users' AND column_name = 'pin'
  ) THEN
    ALTER TABLE public.core_users ALTER COLUMN pin DROP NOT NULL;
    ALTER TABLE public.core_users ALTER COLUMN pin SET DEFAULT '';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'core_users' AND column_name = 'pin_hash'
  ) THEN
    ALTER TABLE public.core_users ALTER COLUMN pin_hash DROP NOT NULL;
    ALTER TABLE public.core_users ALTER COLUMN pin_hash SET DEFAULT '';
  END IF;

  CREATE TABLE IF NOT EXISTS public.core_audit_logs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    app TEXT DEFAULT 'stock',
    timestamp TIMESTAMPTZ DEFAULT now(),
    user_id TEXT,
    user_name TEXT,
    action TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    severity TEXT DEFAULT 'INFO',
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  ALTER TABLE public.core_audit_logs
    ADD COLUMN IF NOT EXISTS app TEXT DEFAULT 'stock',
    ADD COLUMN IF NOT EXISTS action TEXT,
    ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'INFO',
    ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT now();

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'core_audit_logs' AND column_name = 'type'
  ) THEN
    ALTER TABLE public.core_audit_logs ALTER COLUMN type DROP NOT NULL;
    ALTER TABLE public.core_audit_logs ALTER COLUMN type SET DEFAULT 'SYSTEM';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'core_audit_logs' AND column_name = 'category'
  ) THEN
    ALTER TABLE public.core_audit_logs ALTER COLUMN category DROP NOT NULL;
    ALTER TABLE public.core_audit_logs ALTER COLUMN category SET DEFAULT 'SYSTEM';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'core_audit_logs' AND column_name = 'title'
  ) THEN
    ALTER TABLE public.core_audit_logs ALTER COLUMN title DROP NOT NULL;
    ALTER TABLE public.core_audit_logs ALTER COLUMN title SET DEFAULT '';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'core_audit_logs' AND column_name = 'description'
  ) THEN
    ALTER TABLE public.core_audit_logs ALTER COLUMN description DROP NOT NULL;
    ALTER TABLE public.core_audit_logs ALTER COLUMN description SET DEFAULT '';
  END IF;
END $$;

-- 2. Ajout des colonnes requises si absentes (sans droit universel '*' par défaut)
ALTER TABLE public.core_users
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_preparer BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS allowed_depots TEXT[] DEFAULT '{}'::TEXT[],
  ADD COLUMN IF NOT EXISTS department TEXT DEFAULT 'Général',
  ADD COLUMN IF NOT EXISTS trigram TEXT,
  ADD COLUMN IF NOT EXISTS role_id BIGINT DEFAULT 4,
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.core_users ALTER COLUMN allowed_depots SET DEFAULT '{}'::TEXT[];
ALTER TABLE public.core_users ALTER COLUMN role_id SET DEFAULT 4;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_user_id ON public.core_users (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON public.core_users (LOWER(email));

-- 3. Rapprochement automatique des comptes existants par correspondance d'email (uniquement si non encore liés)
UPDATE public.core_users u
SET auth_user_id = a.id,
    updated_at = now()
FROM auth.users a
WHERE u.auth_user_id IS NULL
  AND u.email IS NOT NULL
  AND a.email IS NOT NULL
  AND LOWER(TRIM(u.email)) = LOWER(TRIM(a.email));

-- 4. Fonction trigger lors de la création ou confirmation d'un utilisateur dans auth.users
CREATE OR REPLACE FUNCTION public.handle_auth_user_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_masked_email TEXT;
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.core_users
    SET auth_user_id = NEW.id,
        updated_at = now()
    WHERE auth_user_id IS NULL
      AND LOWER(TRIM(email)) = LOWER(TRIM(NEW.email));
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    v_masked_email := CASE
      WHEN NEW.email IS NULL OR position('@' IN NEW.email) = 0 THEN '***'
      ELSE left(split_part(NEW.email, '@', 1), 2) || '***@' || split_part(NEW.email, '@', 2)
    END;

    INSERT INTO public.core_audit_logs (
      id,
      app,
      user_id,
      action,
      severity,
      details,
      created_at
    ) VALUES (
      gen_random_uuid()::text,
      'stock',
      NEW.id::text,
      'AUTH_LINK_FAILED',
      'ERROR',
      jsonb_build_object(
        'error', SQLERRM,
        'sqlstate', SQLSTATE,
        'masked_email', v_masked_email
      ),
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_auth_user_created() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_user_created();

DROP TRIGGER IF EXISTS trg_on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER trg_on_auth_user_email_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_user_created();
