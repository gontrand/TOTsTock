-- =========================================================================
-- TOT SUITE - SCRIPT 12 : PRÉFÉRENCES UTILISATEUR (12_user_preferences.sql)
-- Schéma 2.2.0
--
-- Crée la table partagée public.core_user_preferences pour synchroniser les
-- préférences d'interface et de confort entre appareils (JSONB plat <= 16 Ko).
--
-- Sécurité RLS (4 politiques) :
--   1. SELECT : l'utilisateur lit uniquement sa ligne, le Super-Admin (rôle 0) peut lire
--   2. INSERT : l'utilisateur n'insère que sa propre ligne
--   3. UPDATE : l'utilisateur ne modifie que sa propre ligne
--   4. DELETE : l'utilisateur ne supprime que sa propre ligne
--   Rôle anon : aucun droit (REVOKE ALL).
--
-- Doit être exécuté après 11_suite_tables.sql et avant 07_app_compat.sql.
-- Rejouable : oui
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. TABLE PUBLIC.CORE_USER_PREFERENCES
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.core_user_preferences (
  user_id TEXT PRIMARY KEY,
  prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.core_user_preferences
  ADD COLUMN IF NOT EXISTS prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Contrainte CHECK idempotente : objet JSON plat <= 16 Ko (16384 octets)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'core_user_preferences'
      AND c.conname = 'chk_core_user_preferences_prefs_object_16k'
  ) THEN
    ALTER TABLE public.core_user_preferences
      ADD CONSTRAINT chk_core_user_preferences_prefs_object_16k
      CHECK (
        jsonb_typeof(prefs) = 'object'
        AND octet_length(prefs::text) <= 16384
      );
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 2. CLÉ ÉTRANGÈRE ET CASCADE À LA SUPPRESSION DE L'UTILISATEUR
-- Compatible base neuve (core_users.id TEXT) et base ancienne (id entier/uuid)
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_user_id_type TEXT;
BEGIN
  SELECT data_type
  INTO v_user_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'core_users'
    AND column_name = 'id';

  IF v_user_id_type IN ('text', 'character varying') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'core_user_preferences'
        AND c.conname = 'fk_core_user_preferences_user'
    ) THEN
      -- Nettoyage d'éventuelles lignes orphelines avant ajout de la FK
      DELETE FROM public.core_user_preferences p
      WHERE NOT EXISTS (
        SELECT 1 FROM public.core_users u WHERE u.id::text = p.user_id
      );

      ALTER TABLE public.core_user_preferences
        ADD CONSTRAINT fk_core_user_preferences_user
        FOREIGN KEY (user_id)
        REFERENCES public.core_users(id)
        ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.trg_fn_cascade_delete_user_preferences()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.core_user_preferences
  WHERE user_id = OLD.id::text;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_fn_cascade_delete_user_preferences() FROM PUBLIC, anon;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'core_users'
  ) THEN
    DROP TRIGGER IF EXISTS trg_cascade_delete_user_preferences ON public.core_users;
    CREATE TRIGGER trg_cascade_delete_user_preferences
      AFTER DELETE ON public.core_users
      FOR EACH ROW
      EXECUTE FUNCTION public.trg_fn_cascade_delete_user_preferences();
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 3. MISE À JOUR AUTOMATIQUE DE updated_at
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_core_user_preferences_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_fn_core_user_preferences_updated_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trg_fn_core_user_preferences_updated_at() TO authenticated;

DROP TRIGGER IF EXISTS trg_core_user_preferences_updated_at ON public.core_user_preferences;
CREATE TRIGGER trg_core_user_preferences_updated_at
  BEFORE UPDATE ON public.core_user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_core_user_preferences_updated_at();

-- -------------------------------------------------------------------------
-- 4. SÉCURITÉ RLS (4 POLITIQUES : SELECT, INSERT, UPDATE, DELETE)
-- -------------------------------------------------------------------------
ALTER TABLE public.core_user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.core_user_preferences FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.core_user_preferences FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.core_user_preferences TO authenticated;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'core_user_preferences'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.core_user_preferences', r.policyname);
  END LOOP;
END $$;

-- 1. Lecture : sa propre ligne ou Super-Admin (rôle 0)
CREATE POLICY "Select own or super_admin core_user_preferences"
  ON public.core_user_preferences
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_id() IS NOT NULL
    AND (
      user_id = public.current_user_id()
      OR public.is_super_admin()
    )
  );

-- 2. Insertion : uniquement sa propre ligne
CREATE POLICY "Insert own core_user_preferences"
  ON public.core_user_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_id() IS NOT NULL
    AND user_id = public.current_user_id()
  );

-- 3. Mise à jour : uniquement sa propre ligne
CREATE POLICY "Update own core_user_preferences"
  ON public.core_user_preferences
  FOR UPDATE
  TO authenticated
  USING (
    public.current_user_id() IS NOT NULL
    AND user_id = public.current_user_id()
  )
  WITH CHECK (
    public.current_user_id() IS NOT NULL
    AND user_id = public.current_user_id()
  );

-- 4. Suppression : uniquement sa propre ligne
CREATE POLICY "Delete own core_user_preferences"
  ON public.core_user_preferences
  FOR DELETE
  TO authenticated
  USING (
    public.current_user_id() IS NOT NULL
    AND user_id = public.current_user_id()
  );
