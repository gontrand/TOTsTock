-- =========================================================================
-- TOT STOCK - SCRIPT 01b : MIGRATION OPTIONNELLE core_users.id VERS TEXT (01b_migrate_users_id_to_text.sql)
-- Description : Convertit public.core_users.id en TEXT si la colonne est encore de type entier.
-- Dépendances : 01_auth_link.sql, 09_core_prefixes.sql
-- Rejouable : oui (idempotent — sans effet si core_users.id est déjà TEXT)
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
    RAISE EXCEPTION 'Prérequis manquant (01b_migrate_users_id_to_text.sql) : La table public.core_users est absente.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'core_users' AND column_name = 'id'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (01b_migrate_users_id_to_text.sql) : La colonne public.core_users.id est absente.';
  END IF;
END $$;

DO $$
DECLARE
  v_col_type TEXT;
BEGIN
  SELECT data_type INTO v_col_type
  FROM information_schema.columns 
  WHERE table_schema = 'public' AND table_name = 'core_users' AND column_name = 'id';

  IF v_col_type IN ('bigint', 'integer', 'smallint') THEN
    RAISE NOTICE 'Conversion de public.core_users.id (% -> text) en cours...', v_col_type;

    DROP VIEW IF EXISTS public.users;
    ALTER TABLE public.core_users ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE public.core_users ALTER COLUMN id TYPE TEXT USING id::text;
    ALTER TABLE public.core_users ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'core_departments' AND column_name = 'manager_id'
        AND data_type IN ('bigint', 'integer', 'smallint')
    ) THEN
      DROP VIEW IF EXISTS public.departments;
      ALTER TABLE public.core_departments ALTER COLUMN manager_id DROP DEFAULT;
      ALTER TABLE public.core_departments ALTER COLUMN manager_id TYPE TEXT USING manager_id::text;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'core_projects' AND column_name = 'manager_id'
        AND data_type IN ('bigint', 'integer', 'smallint')
    ) THEN
      DROP VIEW IF EXISTS public.projects;
      ALTER TABLE public.core_projects ALTER COLUMN manager_id DROP DEFAULT;
      ALTER TABLE public.core_projects ALTER COLUMN manager_id TYPE TEXT USING manager_id::text;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = '_tot_refresh_compat_views'
    ) THEN
      PERFORM public._tot_refresh_compat_views();
    END IF;

    RAISE NOTICE 'Migration de public.core_users.id vers TEXT effectuée avec succès.';
  ELSE
    RAISE NOTICE 'public.core_users.id est déjà de type % : aucune migration nécessaire.', v_col_type;
  END IF;
END $$;
