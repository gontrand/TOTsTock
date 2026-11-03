-- =========================================================================
-- FICHIER GÉNÉRÉ AUTOMATIQUEMENT PAR scripts/build-sql.mjs — NE PAS MODIFIER DIRECTEMENT
-- Source de vérité : supabase-client/01_auth_link.sql
-- Étape 01 : Liaison Supabase Auth (auth.users <-> public.users)
-- =========================================================================
-- =========================================================================
-- TOT STOCK - SCRIPT 01 : AUTH LINK (01_auth_link.sql)
-- Liaison entre Supabase Auth (auth.users) et les profils métier (public.users)
-- Rejouable : oui
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
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (01_auth_link.sql) : La table public.users est absente. Exécutez d''abord le schéma de base (supabase/migrations/20261003_complete_tot_stock_schema.sql).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (01_auth_link.sql) : La colonne public.users.email est absente.';
  END IF;
END $$;

-- 1. Harmonisation de la table public.users et de public.audit_logs :
--    - Rendre 'pin' et 'pin_hash' optionnels (NULL) pour l'authentification Auth
--    - Assurer les colonnes d'audit (action, severity, details) sur public.audit_logs
--    - Nettoyer UNIQUEMENT les triggers obsolètes explicitement nommés et justifiés
--    (Note architecture : La conversion de users.id en TEXT ne se fait plus automatiquement ici.
--     Elle est fournie dans la migration dédiée et documentée : 01b_migrate_users_id_to_text.sql)
DO $$
BEGIN
  -- Suppression ciblée et justifiée des anciens triggers obsolètes :
  -- 1. trg_users_enforce_pin : exigeait un PIN numérique à 4 chiffres, incompatible avec l'authentification par mot de passe Auth.
  DROP TRIGGER IF EXISTS trg_users_enforce_pin ON public.users;
  -- 2. trg_sync_user_to_auth : ancien trigger de synchronisation bidirectionnelle causant des boucles de récursion et des blocages.
  DROP TRIGGER IF EXISTS trg_sync_user_to_auth ON public.users;
  -- 3. trg_users_auto_id_int : forçait un ID entier séquentiel lors de l'insertion, causant des conflits avec les nouveaux identifiants.
  DROP TRIGGER IF EXISTS trg_users_auto_id_int ON public.users;

  -- Rendre pin optionnel (NULL) si la colonne existe encore
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'pin'
  ) THEN
    ALTER TABLE public.users ALTER COLUMN pin DROP NOT NULL;
    ALTER TABLE public.users ALTER COLUMN pin SET DEFAULT '';
  END IF;

  -- Rendre pin_hash optionnel si la colonne existe
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'pin_hash'
  ) THEN
    ALTER TABLE public.users ALTER COLUMN pin_hash DROP NOT NULL;
    ALTER TABLE public.users ALTER COLUMN pin_hash SET DEFAULT '';
  END IF;

  -- S'assurer que public.audit_logs existe et dispose des colonnes action, severity, details (Point 5)
  CREATE TABLE IF NOT EXISTS public.audit_logs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    timestamp TIMESTAMPTZ DEFAULT now(),
    user_id TEXT,
    user_name TEXT,
    action TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    severity TEXT DEFAULT 'INFO',
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  ALTER TABLE public.audit_logs
    ADD COLUMN IF NOT EXISTS action TEXT,
    ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'INFO',
    ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT now();

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'type'
  ) THEN
    ALTER TABLE public.audit_logs ALTER COLUMN type DROP NOT NULL;
    ALTER TABLE public.audit_logs ALTER COLUMN type SET DEFAULT 'SYSTEM';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'category'
  ) THEN
    ALTER TABLE public.audit_logs ALTER COLUMN category DROP NOT NULL;
    ALTER TABLE public.audit_logs ALTER COLUMN category SET DEFAULT 'SYSTEM';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'title'
  ) THEN
    ALTER TABLE public.audit_logs ALTER COLUMN title DROP NOT NULL;
    ALTER TABLE public.audit_logs ALTER COLUMN title SET DEFAULT '';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'description'
  ) THEN
    ALTER TABLE public.audit_logs ALTER COLUMN description DROP NOT NULL;
    ALTER TABLE public.audit_logs ALTER COLUMN description SET DEFAULT '';
  END IF;
END $$;

-- 2. Ajout des colonnes requises si absentes (sans droit universel '*' par défaut)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_preparer BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS allowed_depots TEXT[] DEFAULT '{}'::TEXT[],
  ADD COLUMN IF NOT EXISTS department TEXT DEFAULT 'Général',
  ADD COLUMN IF NOT EXISTS trigram TEXT,
  ADD COLUMN IF NOT EXISTS role_id BIGINT DEFAULT 4,
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.users ALTER COLUMN allowed_depots SET DEFAULT '{}'::TEXT[];
ALTER TABLE public.users ALTER COLUMN role_id SET DEFAULT 4;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_user_id ON public.users (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON public.users (LOWER(email));

-- 3. Rapprochement automatique des comptes existants par correspondance d'email (uniquement si non encore liés)
UPDATE public.users u
SET auth_user_id = a.id,
    updated_at = now()
FROM auth.users a
WHERE u.auth_user_id IS NULL
  AND u.email IS NOT NULL
  AND a.email IS NOT NULL
  AND LOWER(TRIM(u.email)) = LOWER(TRIM(a.email));

-- 4. Fonction trigger lors de la création ou confirmation d'un utilisateur dans auth.users
-- Sécurité V18 & Point 5 (v23) :
--   - Ne lit JAMAIS raw_user_meta_data->>'role_id' (contrôlé par le client)
--   - N'attribue JAMAIS le rôle 0 ni allowed_depots = ARRAY['*'] automatiquement
--   - Lie uniquement un profil métier préexistant (créé par un administrateur via admin-users)
--     dont l'e-mail a été confirmé et dont auth_user_id est encore NULL.
--   - En cas d'erreur, journalise dans public.audit_logs (action = 'AUTH_LINK_FAILED',
--     severity = 'ERROR', details avec SQLERRM et l'e-mail masqué) puis retourne NEW.
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
    UPDATE public.users
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

    INSERT INTO public.audit_logs (
      id,
      user_id,
      action,
      severity,
      details,
      created_at
    ) VALUES (
      gen_random_uuid()::text,
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
