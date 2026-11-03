-- =========================================================================
-- TOT STOCK - SCRIPT 01b : MIGRATION OPTIONNELLE users.id VERS TEXT
-- Rejouable : oui (Optionnel : uniquement si public.users.id est entier)
-- =========================================================================
-- Contexte :
-- Dans les versions initiales de TOT STOCK, la colonne public.users.id pouvait
-- être typée en BIGINT/INTEGER avec une séquence auto-incrémentée.
-- La version V13+ supporte les identifiants textuels/UUID (ex: v_uid::text)
-- pour une corrélation directe et sans friction avec auth.users.id.
--
-- Cette migration convertit en toute sécurité la clé primaire de public.users
-- et les références associées (clés étrangères) vers le type TEXT.
--
-- IMPORTANT :
-- 1. Exécuter ce script uniquement si public.users.id est actuellement de type
--    BIGINT, INTEGER ou SMALLINT.
-- 2. Faites une sauvegarde avant l'exécution.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. VÉRIFICATION DES PRÉREQUIS (Point 3)
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (01b_migrate_users_id_to_text.sql) : La table public.users est absente.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (01b_migrate_users_id_to_text.sql) : La colonne public.users.id est absente.';
  END IF;
END $$;

DO $$
DECLARE
  v_col_type TEXT;
BEGIN
  SELECT data_type INTO v_col_type
  FROM information_schema.columns 
  WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id';

  IF v_col_type IN ('bigint', 'integer', 'smallint') THEN
    RAISE NOTICE 'Conversion de public.users.id (% -> text) en cours...', v_col_type;

    -- 1. Supprimer la valeur par défaut liée à l'ancienne séquence
    ALTER TABLE public.users ALTER COLUMN id DROP DEFAULT;

    -- 2. Conversion du type de la colonne id vers TEXT
    ALTER TABLE public.users ALTER COLUMN id TYPE TEXT USING id::text;

    -- 3. Définir un DEFAULT moderne basé sur UUID textuel
    ALTER TABLE public.users ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

    -- 4. Harmonisation des tables référençant users(id) si nécessaire
    -- (departments.manager_id, projects.manager_id)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'departments' AND column_name = 'manager_id'
        AND data_type IN ('bigint', 'integer', 'smallint')
    ) THEN
      ALTER TABLE public.departments ALTER COLUMN manager_id DROP DEFAULT;
      ALTER TABLE public.departments ALTER COLUMN manager_id TYPE TEXT USING manager_id::text;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'manager_id'
        AND data_type IN ('bigint', 'integer', 'smallint')
    ) THEN
      ALTER TABLE public.projects ALTER COLUMN manager_id DROP DEFAULT;
      ALTER TABLE public.projects ALTER COLUMN manager_id TYPE TEXT USING manager_id::text;
    END IF;

    RAISE NOTICE 'Migration de public.users.id vers TEXT effectuée avec succès.';
  ELSE
    RAISE NOTICE 'public.users.id est déjà de type % : aucune migration nécessaire.', v_col_type;
  END IF;
END $$;
