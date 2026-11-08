-- =========================================================================
-- 18_password_reset.sql  (schéma 2.8.0 — app 5.14.0)
-- Réinitialisation du mot de passe par code à usage unique (fonction Edge APP_TOT-Stock_password-reset)
--
--  * core_password_resets : une ligne par demande (code stocké HACHÉ : SHA-256 + sel, jamais en clair),
--    validité 15 min, 5 essais maximum, statuts PENDING / USED / LOCKED / SUPERSEDED / NOUSER.
--  * Accès réservé au rôle service_role (la fonction Edge). RLS activée, aucune politique : ni anon ni authenticated.
--  * RPC internes (service_role uniquement) : pwreset_request, pwreset_begin_confirm, pwreset_lock, pwreset_complete,
--    pwreset_revoke_sessions, pwreset_purge.
--  * Limitation : 3 demandes / heure / e-mail et 10 / heure / adresse IP (les demandes pour un e-mail inconnu comptent aussi,
--    afin de ne rien révéler sur l'existence des comptes).
-- Idempotent : peut être relancé sans risque.
-- =========================================================================

-- -------------------------------------------------------------------------
-- Garde-fou : si une table / des fonctions du même nom existent déjà avec une AUTRE structure (créées à la main ou par une
-- version précédente), on les remplace. Les codes sont éphémères (15 min) : aucune donnée utile n'est perdue.
-- -------------------------------------------------------------------------
DO $$
DECLARE r record; v_missing int;
BEGIN
  IF to_regclass('public.core_password_resets') IS NOT NULL THEN
    SELECT count(*) INTO v_missing
      FROM unnest(ARRAY['id','user_id','email_norm','code_hash','salt','status','attempts','ip','created_at','expires_at','used_at']) AS c(col)
     WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'core_password_resets' AND column_name = c.col);
    IF v_missing > 0 THEN
      RAISE NOTICE 'core_password_resets existante avec une autre structure (% colonne(s) manquante(s)) : recréation', v_missing;
      DROP TABLE public.core_password_resets CASCADE;
    END IF;
  END IF;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'pwreset\_%' ESCAPE '\'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.core_password_resets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT,
  email_norm  TEXT NOT NULL,
  code_hash   TEXT,
  salt        TEXT,
  status      TEXT NOT NULL DEFAULT 'PENDING',
  attempts    INT  NOT NULL DEFAULT 0,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  used_at     TIMESTAMPTZ
);

ALTER TABLE public.core_password_resets DROP CONSTRAINT IF EXISTS core_password_resets_status_check;
ALTER TABLE public.core_password_resets
  ADD CONSTRAINT core_password_resets_status_check
  CHECK (status IN ('PENDING','USED','LOCKED','SUPERSEDED','NOUSER'));

CREATE INDEX IF NOT EXISTS idx_pwreset_email_created ON public.core_password_resets (email_norm, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pwreset_ip_created    ON public.core_password_resets (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pwreset_user_status   ON public.core_password_resets (user_id, status);

ALTER TABLE public.core_password_resets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pwreset_no_client_access ON public.core_password_resets;
CREATE POLICY pwreset_no_client_access ON public.core_password_resets
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.core_password_resets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.core_password_resets TO service_role;

-- -------------------------------------------------------------------------
-- pwreset_request : enregistre une demande et applique la limitation.
-- Retourne { status: OK | RATE_LIMITED | NO_USER, user_id, user_name, auth_user_id, email }.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pwreset_request(
  p_email TEXT, p_ip TEXT, p_code_hash TEXT, p_salt TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email TEXT := lower(btrim(coalesce(p_email, '')));
  v_ip    TEXT := nullif(btrim(coalesce(p_ip, '')), '');
  v_user  RECORD;
  v_n_email INT;
  v_n_ip    INT;
BEGIN
  IF v_email = '' OR length(v_email) > 254 THEN
    RETURN jsonb_build_object('status', 'NO_USER');
  END IF;

  SELECT count(*) INTO v_n_email FROM public.core_password_resets
   WHERE email_norm = v_email AND created_at > now() - interval '1 hour';
  SELECT count(*) INTO v_n_ip FROM public.core_password_resets
   WHERE v_ip IS NOT NULL AND ip = v_ip AND created_at > now() - interval '1 hour';

  IF v_n_email >= 3 OR v_n_ip >= 10 THEN
    RETURN jsonb_build_object('status', 'RATE_LIMITED');
  END IF;

  SELECT id, name, email, auth_user_id INTO v_user
    FROM public.core_users
   WHERE lower(btrim(email)) = v_email
     AND coalesce(is_blocked, false) = false
     AND auth_user_id IS NOT NULL
   ORDER BY created_at ASC NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.core_password_resets (user_id, email_norm, status, ip, expires_at)
    VALUES (NULL, v_email, 'NOUSER', v_ip, now());
    RETURN jsonb_build_object('status', 'NO_USER');
  END IF;

  -- Un seul code actif par utilisateur
  UPDATE public.core_password_resets
     SET status = 'SUPERSEDED'
   WHERE user_id = v_user.id AND status = 'PENDING';

  INSERT INTO public.core_password_resets (user_id, email_norm, code_hash, salt, status, ip)
  VALUES (v_user.id, v_email, p_code_hash, p_salt, 'PENDING', v_ip);

  RETURN jsonb_build_object(
    'status', 'OK',
    'user_id', v_user.id,
    'user_name', v_user.name,
    'auth_user_id', v_user.auth_user_id,
    'email', v_user.email
  );
END $$;

-- -------------------------------------------------------------------------
-- pwreset_begin_confirm : verrouille la dernière demande valide et compte l'essai (atomique).
-- Retourne { status: OK | NONE | LOCKED, id, salt, code_hash, user_id, user_name, auth_user_id, attempts }.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pwreset_begin_confirm(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email TEXT := lower(btrim(coalesce(p_email, '')));
  r RECORD;
  u RECORD;
BEGIN
  SELECT * INTO r FROM public.core_password_resets
   WHERE email_norm = v_email AND status = 'PENDING' AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'NONE');
  END IF;

  IF r.attempts >= 5 THEN
    UPDATE public.core_password_resets SET status = 'LOCKED' WHERE id = r.id;
    RETURN jsonb_build_object('status', 'LOCKED', 'user_id', r.user_id);
  END IF;

  UPDATE public.core_password_resets SET attempts = attempts + 1 WHERE id = r.id;

  SELECT id, name, auth_user_id INTO u FROM public.core_users WHERE id = r.user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'NONE');
  END IF;

  RETURN jsonb_build_object(
    'status', 'OK',
    'id', r.id,
    'salt', r.salt,
    'code_hash', r.code_hash,
    'user_id', u.id,
    'user_name', u.name,
    'auth_user_id', u.auth_user_id,
    'attempts', r.attempts + 1
  );
END $$;

-- -------------------------------------------------------------------------
-- pwreset_lock : verrouille une demande après le dernier essai raté (appelée par la fonction Edge).
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pwreset_lock(p_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.core_password_resets SET status = 'LOCKED' WHERE id = p_id AND status = 'PENDING';
$$;

-- -------------------------------------------------------------------------
-- pwreset_complete : marque la demande utilisée, invalide les autres, lève l'obligation de changement de PIN.
-- Retourne true si la demande était encore valide (usage unique garanti).
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pwreset_complete(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user TEXT;
  v_rows INT;
BEGIN
  UPDATE public.core_password_resets
     SET status = 'USED', used_at = now()
   WHERE id = p_id AND status = 'PENDING' AND expires_at > now()
  RETURNING user_id INTO v_user;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN false;
  END IF;

  UPDATE public.core_password_resets
     SET status = 'SUPERSEDED'
   WHERE user_id = v_user AND status = 'PENDING';

  UPDATE public.core_users
     SET must_change_pin = false, updated_at = now()
   WHERE id = v_user;

  RETURN true;
END $$;

-- -------------------------------------------------------------------------
-- pwreset_purge : supprime les demandes de plus de 7 jours.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pwreset_purge()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  DELETE FROM public.core_password_resets WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- -------------------------------------------------------------------------
-- pwreset_revoke_sessions : coupe toutes les sessions Supabase Auth de l'utilisateur après un changement de mot de passe.
-- Sans effet (retourne 0) si auth.sessions n'existe pas.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pwreset_revoke_sessions(p_auth_user_id UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT := 0;
BEGIN
  IF p_auth_user_id IS NULL OR to_regclass('auth.sessions') IS NULL THEN
    RETURN 0;
  END IF;
  EXECUTE 'DELETE FROM auth.sessions WHERE user_id = $1' USING p_auth_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.refresh_tokens WHERE user_id = $1' USING p_auth_user_id::text;
  END IF;
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pwreset_revoke_sessions: %', SQLERRM;
  RETURN 0;
END $$;

-- Droits : service_role uniquement
REVOKE EXECUTE ON FUNCTION public.pwreset_request(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pwreset_begin_confirm(TEXT)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pwreset_lock(UUID)                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pwreset_complete(UUID)                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pwreset_purge()                         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pwreset_revoke_sessions(UUID)           FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.pwreset_request(TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT  EXECUTE ON FUNCTION public.pwreset_begin_confirm(TEXT)             TO service_role;
GRANT  EXECUTE ON FUNCTION public.pwreset_lock(UUID)                      TO service_role;
GRANT  EXECUTE ON FUNCTION public.pwreset_complete(UUID)                  TO service_role;
GRANT  EXECUTE ON FUNCTION public.pwreset_purge()                         TO service_role;
GRANT  EXECUTE ON FUNCTION public.pwreset_revoke_sessions(UUID)           TO service_role;

NOTIFY pgrst, 'reload schema';
