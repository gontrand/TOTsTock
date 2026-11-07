-- =========================================================================
-- FICHIER GÉNÉRÉ AUTOMATIQUEMENT PAR scripts/build-sql.mjs — NE PAS MODIFIER DIRECTEMENT
-- Source de vérité : supabase-client/05_rpc_admin_users.sql
-- Étape 05 : Sécurité utilisateurs, get_or_link_my_profile() et révocation annuaire anonyme
-- =========================================================================
-- =========================================================================
-- TOT STOCK - SCRIPT 05 : GESTION SÉCURISÉE DES UTILISATEURS (05_rpc_admin_users.sql)
-- Description : Sécurité V18 & Point 5 :
--   - Aucun rôle 0, aucun raw_user_meta_data->>'role_id', ni droit universel '*' attribué automatiquement
--   - Aucune création automatique de profil dans handle_auth_user_created() ni get_or_link_my_profile()
--   - En cas d'erreur dans handle_auth_user_created(), capture et écriture dans core_audit_logs (AUTH_LINK_FAILED)
--   - Aucune politique d'écriture directe client sur public.core_users (tout passe par l'Edge Function admin-users)
--   - Suppression définitive de l'annuaire anonyme (get_login_users_directory / get_login_directory)
-- Dépendances : 01_auth_link.sql, 02_rls_hardening.sql
-- Rejouable : oui (idempotent)
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. VÉRIFICATION DES PRÉREQUIS (Point 3)
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'core_users'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (05_rpc_admin_users.sql) : La table public.core_users est absente. Exécutez d''abord 01_auth_link.sql et 02_rls_hardening.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'core_roles'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (05_rpc_admin_users.sql) : La table public.core_roles est absente. Exécutez d''abord 02_rls_hardening.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'core_audit_logs'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (05_rpc_admin_users.sql) : La table public.core_audit_logs est absente. Exécutez d''abord 01_auth_link.sql et 02_rls_hardening.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'current_user_id'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (05_rpc_admin_users.sql) : La fonction public.current_user_id() est absente. Exécutez d''abord 02_rls_hardening.sql.';
  END IF;
END $$;

-- 1. Harmonisation non-destructive des colonnes pin / pin_hash dans public.core_users et core_audit_logs
DO $$
BEGIN
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

  ALTER TABLE public.core_audit_logs
    ADD COLUMN IF NOT EXISTS app TEXT DEFAULT 'stock',
    ADD COLUMN IF NOT EXISTS action TEXT,
    ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'INFO',
    ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT now();
END $$;

-- 2. Ajout des colonnes requises si absentes (sans octroi automatique de '*')
ALTER TABLE public.core_users
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_preparer BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS allowed_depots TEXT[] DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS department TEXT DEFAULT 'Général',
  ADD COLUMN IF NOT EXISTS trigram TEXT,
  ADD COLUMN IF NOT EXISTS role_id BIGINT DEFAULT 3,
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_user_id ON public.core_users (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON public.core_users (LOWER(email));

-- 3. Rapprochement initial des comptes existants uniquement si l'e-mail Auth est confirmé et auth_user_id est NULL
UPDATE public.core_users u
SET auth_user_id = a.id
FROM auth.users a
WHERE a.email_confirmed_at IS NOT NULL
  AND LOWER(TRIM(u.email)) = LOWER(TRIM(a.email))
  AND u.auth_user_id IS NULL;

-- 4. Trigger de liaison automatique sécurisé (V18 + Point 5 : ZÉRO création automatique de profil,
--    ZÉRO escalade de rôle, capture d'erreur dans core_audit_logs avec action AUTH_LINK_FAILED, severity ERROR,
--    SQLERRM et e-mail masqué, sans jamais bloquer la création du compte Auth)
CREATE OR REPLACE FUNCTION public.handle_auth_user_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_masked_email TEXT;
BEGIN
  IF NEW.email_confirmed_at IS NULL OR NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.core_users
  SET auth_user_id = NEW.id,
      updated_at = now()
  WHERE LOWER(TRIM(email)) = LOWER(TRIM(NEW.email))
    AND auth_user_id IS NULL;

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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users CASCADE;
DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users CASCADE;
DROP TRIGGER IF EXISTS trg_on_auth_user_email_confirmed ON auth.users CASCADE;
DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users CASCADE;

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_user_created();

CREATE TRIGGER trg_on_auth_user_email_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_auth_user_created();

-- 5. Suppression de la RPC obsolète public.admin_manage_user et des RPC d'annuaire anonyme
DROP FUNCTION IF EXISTS public.admin_manage_user(TEXT, JSONB) CASCADE;
DROP FUNCTION IF EXISTS public.get_login_users_directory() CASCADE;
DROP FUNCTION IF EXISTS public.get_login_directory() CASCADE;

-- -------------------------------------------------------------------------
-- 6. VISIBILITÉ INTER-DÉPARTEMENTS (PROJETS ET UTILISATEURS)
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_dept_manager_or_deputy()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.core_departments d
    JOIN public.core_users u ON (u.auth_user_id = auth.uid() OR u.id::text = public.current_user_id())
    WHERE (d.manager_id::text = u.id::text)
       OR (d.deputy_manager_ids IS NOT NULL AND u.id::text = ANY(ARRAY(SELECT unnest(d.deputy_manager_ids)::text)))
  );
$$;

REVOKE ALL ON FUNCTION public.is_dept_manager_or_deputy() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_dept_manager_or_deputy() TO authenticated;

-- RLS sur public.core_projects (purge de toute règle existante avant recréation)
DO $$
DECLARE
  r RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'core_projects') THEN
    ALTER TABLE public.core_projects ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.core_projects FROM anon, public;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.core_projects TO authenticated;

    FOR r IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'core_projects'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.core_projects', r.policyname);
    END LOOP;

    CREATE POLICY "Authenticated read core_projects" ON public.core_projects
      FOR SELECT TO authenticated
      USING (
        public.current_user_role() = 0
        OR public.current_user_has_perm('perm_depproj_menu')
        OR public.current_user_has_perm('perm_mov_view_all')
        OR public.is_dept_manager_or_deputy()
        OR EXISTS (
          SELECT 1 FROM public.core_users u
          WHERE (u.auth_user_id = auth.uid() OR u.id::text = public.current_user_id())
            AND (
              core_projects.department_id::text IN (
                SELECT d.id::text FROM public.core_departments d WHERE LOWER(TRIM(d.name)) = LOWER(TRIM(u.department))
              )
              OR core_projects.manager_id::text = u.id::text
              OR (core_projects.deputy_manager_ids IS NOT NULL AND u.id::text = ANY(ARRAY(SELECT unnest(core_projects.deputy_manager_ids)::text)))
            )
        )
      );

    CREATE POLICY "Admin write core_projects" ON public.core_projects
      FOR ALL TO authenticated
      USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_depproj_menu') OR public.current_user_has_perm('perm_proj_edit'))
      WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_depproj_menu') OR public.current_user_has_perm('perm_proj_edit'));
  END IF;
END $$;

-- RLS sur public.core_users (Sécurité V18 + v37 : purge totale de toutes les règles existantes quel que soit leur nom,
-- lecture réservée à authenticated, aucune écriture directe client)
DO $$
DECLARE
  r RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'core_users') THEN
    ALTER TABLE public.core_users ENABLE ROW LEVEL SECURITY;

    FOR r IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'core_users'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.core_users', r.policyname);
    END LOOP;

    REVOKE ALL ON TABLE public.core_users FROM anon, authenticated, public;
    GRANT SELECT (
      id, name, trigram, email, department, role_id, is_blocked,
      allowed_depots, must_change_pin, is_preparer, auth_user_id, created_at, updated_at
    ) ON TABLE public.core_users TO authenticated;

    CREATE POLICY "Authenticated read core_users" ON public.core_users
      FOR SELECT TO authenticated
      USING (public.current_user_id() IS NOT NULL);
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 7. FONCTION DE RÉCUPÉRATION ET LIAISON DU PROFIL CONNECTÉ (get_or_link_my_profile)
-- Sécurité V18 : Lie uniquement un profil préexistant créé par un administrateur.
-- Ne crée JAMAIS de profil automatiquement et n'attribue JAMAIS role_id = 0.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_link_my_profile()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_email_confirmed_at TIMESTAMPTZ;
  v_user RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;

  SELECT email, email_confirmed_at
  INTO v_email, v_email_confirmed_at
  FROM auth.users
  WHERE id = v_uid;

  -- 1. Chercher par auth_user_id
  SELECT
    id, auth_user_id, name, trigram, email, department, role_id,
    is_blocked, must_change_pin, is_preparer, allowed_depots, created_at, updated_at
  INTO v_user
  FROM public.core_users
  WHERE auth_user_id = v_uid
  LIMIT 1;

  -- 2. Si non trouvé et e-mail confirmé, lier un profil existant non encore rattaché (auth_user_id IS NULL)
  IF v_user IS NULL AND v_email IS NOT NULL AND v_email_confirmed_at IS NOT NULL THEN
    UPDATE public.core_users
    SET auth_user_id = v_uid,
        updated_at = now()
    WHERE LOWER(TRIM(email)) = LOWER(TRIM(v_email))
      AND auth_user_id IS NULL;

    SELECT
      id, auth_user_id, name, trigram, email, department, role_id,
      is_blocked, must_change_pin, is_preparer, allowed_depots, created_at, updated_at
    INTO v_user
    FROM public.core_users
    WHERE auth_user_id = v_uid
    LIMIT 1;
  END IF;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Aucun profil autorisé associé à ce compte. Contactez un administrateur.'
    );
  END IF;

  IF COALESCE(v_user.is_blocked, false) = true THEN
    RAISE EXCEPTION 'Ce compte utilisateur est bloqué.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user', to_jsonb(v_user)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_link_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_link_my_profile() TO authenticated;

-- 8. MISE À JOUR IDEMPOTENTE DES RÔLES EXISTANTS (perm_mov_view_all, perm_view_all_login_logs, perm_manage_currency, perm_manage_users)
UPDATE public.core_roles
SET permissions = array_append(permissions, 'perm_mov_view_all')
WHERE id::text = '1' AND NOT ('perm_mov_view_all' = ANY(permissions));

UPDATE public.core_roles
SET permissions = array_append(permissions, 'perm_view_all_login_logs')
WHERE id::text = '1' AND NOT ('perm_view_all_login_logs' = ANY(permissions));

UPDATE public.core_roles
SET permissions = array_append(permissions, 'perm_manage_currency')
WHERE id::text = '1' AND NOT ('perm_manage_currency' = ANY(permissions));

UPDATE public.core_roles
SET permissions = array_append(permissions, 'perm_manage_users')
WHERE id::text = '1' AND NOT ('perm_manage_users' = ANY(permissions));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_tot_refresh_compat_views'
  ) THEN
    PERFORM public._tot_refresh_compat_views();
  END IF;
END $$;
