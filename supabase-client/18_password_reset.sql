-- =========================================================================
-- TOT STOCK - SCRIPT 18 : RÉINITIALISATION DU MOT DE PASSE PAR CODE (18_password_reset.sql)
-- Schéma 2.8.0 (App 5.14.0)
-- Description :
--   1. Crée la table public.core_password_resets pour stocker les codes à 6 chiffres
--      hachés (SHA-256), avec expiration (15 min), compteur d'essais (max 5)
--      et horodatage d'utilisation.
--   2. Verrouille strictement l'accès RLS : aucun accès direct pour anon ni authenticated ;
--      seule la fonction Edge APP_TOT-Stock_password-reset (via service_role) peut lire/écrire.
--   3. Fournit la fonction de nettoyage public.purge_expired_password_resets().
-- Dépendances : 00..17
-- Ordre d'exécution : 18 (après 17_transferts_valides.sql, avant 07_app_compat.sql)
-- Idempotent / Rejouable : oui
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. VÉRIFICATION DES PRÉREQUIS
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'core_users'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (18_password_reset.sql) : La table public.core_users est absente.';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 1. TABLE public.core_password_resets
-- -------------------------------------------------------------------------
-- Garde-fou : une version précédente de ce script (colonnes email_norm / salt / ip / status) peut avoir laissé une table
-- d'une autre structure. Les codes sont éphémères (15 min) : elle est simplement recréée, sans perte utile.
DO $$
BEGIN
  IF to_regclass('public.core_password_resets') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'core_password_resets' AND column_name = 'email_norm') THEN
    DROP TABLE public.core_password_resets CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.core_password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  code_salt TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  used_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  request_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.core_password_resets
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS code_hash TEXT,
  ADD COLUMN IF NOT EXISTS code_salt TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS request_ip TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_core_password_resets_email_created
  ON public.core_password_resets (email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_core_password_resets_email_lower_created
  ON public.core_password_resets (LOWER(email), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_core_password_resets_user_created
  ON public.core_password_resets (user_id, created_at DESC);

-- -------------------------------------------------------------------------
-- 2. RLS & PRIVILÈGES (service_role uniquement, aucun accès anon / authenticated)
-- -------------------------------------------------------------------------
ALTER TABLE public.core_password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.core_password_resets FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'core_password_resets'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.core_password_resets', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "core_password_resets_service_role_only"
  ON public.core_password_resets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.core_password_resets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.core_password_resets TO service_role;

-- -------------------------------------------------------------------------
-- 3. FONCTION DE PURGE DES CODES EXPIRÉS (service_role uniquement)
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.purge_expired_password_resets();

CREATE OR REPLACE FUNCTION public.purge_expired_password_resets()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.core_password_resets
  WHERE expires_at < now() - interval '1 hour'
     OR (used_at IS NOT NULL AND used_at < now() - interval '1 hour');
$$;

REVOKE ALL ON FUNCTION public.purge_expired_password_resets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_password_resets() TO service_role;
