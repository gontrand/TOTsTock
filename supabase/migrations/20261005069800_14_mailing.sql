-- =========================================================================
-- FICHIER GÉNÉRÉ AUTOMATIQUEMENT PAR scripts/build-sql.mjs — NE PAS MODIFIER DIRECTEMENT
-- Source de vérité : supabase-client/14_mailing.sql
-- Étape 14 : Mailing multi-fournisseurs, expéditeurs par application (stk, hab, rpt, tools) et journal core_mail_log
-- =========================================================================
-- =========================================================================
-- TOT SUITE - SCRIPT 14 : MAILING MULTI-FOURNISSEURS & EXPÉDITEURS PAR APPLICATION (14_mailing.sql)
-- Schéma 2.4.1 (App 5.9.1)
-- Dépendances : 00_complete_tot_stock_schema.sql, 09_core_prefixes.sql, 01_auth_link.sql, 02_rls_hardening.sql
-- Ordre d'exécution : après 13_transfer_stock_batch.sql et avant 07_app_compat.sql
-- Rejouable : oui (100 % idempotent : base neuve x2, base sans Vault x2, base avec Vault + migration Brevo + Microsoft 365 Graph)
--
-- Crée :
--   1. public.core_mail_accounts : comptes d'envoi (brevo, resend, sendgrid, mailgun, postmark, mailjet, smtp, msgraph)
--      sans aucun secret dans la table (secret stocké dans Supabase Vault sous 'mail_account_<uuid>').
--   2. public.core_mail_senders  : un expéditeur par application de la suite TOT ('stk', 'hab', 'rpt', 'tools').
--   3. public.core_mail_log      : journal des envois (destinataire masqué, statut, fournisseur, erreur, message_id).
--   4. RPC sécurisées :
--      - public.set_mail_account_secret(p_account_id uuid, p_secret text) (administrateurs uniquement)
--      - public.mail_account_has_secret(p_account_id uuid) (administrateurs uniquement)
--      - public.get_mail_config(p_app_code text) (service_role uniquement, compatible PostgREST request.jwt.claims JSON, avec repli legacy Brevo)
--      - public.purge_mail_log(p_days integer) (administrateurs uniquement)
--   5. Migration automatique (une seule fois) de l'ancienne configuration Brevo vers core_mail_accounts + expéditeur 'stk'.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. FONCTION D'AUTORISATION ADMINISTRATEUR MAILING
-- Réservée aux rôles 0, 1, 5, 8 ou détenteurs de perm_config_email ou perm_config_db
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tot_is_mail_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_id INT;
  v_jwt_claims_raw TEXT;
  v_jwt_claims_role TEXT := '';
BEGIN
  v_jwt_claims_raw := NULLIF(trim(COALESCE(current_setting('request.jwt.claims', true), '')), '');
  IF v_jwt_claims_raw IS NOT NULL AND left(v_jwt_claims_raw, 1) = '{' THEN
    BEGIN
      v_jwt_claims_role := COALESCE(v_jwt_claims_raw::jsonb ->> 'role', '');
    EXCEPTION WHEN OTHERS THEN
      v_jwt_claims_role := '';
    END;
  END IF;

  IF COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     OR v_jwt_claims_role = 'service_role'
     OR COALESCE(current_setting('role', true), '') = 'service_role' THEN
    RETURN true;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT u.role_id INTO v_role_id
  FROM public.core_users u
  WHERE (u.auth_user_id = auth.uid() OR u.id::text = auth.uid()::text)
    AND COALESCE(u.is_blocked, false) = false
  LIMIT 1;

  IF v_role_id IS NULL THEN
    RETURN false;
  END IF;

  IF v_role_id IN (0, 1, 5, 8) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_user_has_perm'
  ) THEN
    IF public.current_user_has_perm('perm_config_email')
       OR public.current_user_has_perm('perm_config_db') THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public._tot_is_mail_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._tot_is_mail_admin() TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 1. TABLE public.core_mail_accounts (Aucun secret stocké dans la table)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.core_mail_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  preset TEXT DEFAULT NULL,
  smtp_host TEXT DEFAULT NULL,
  smtp_port INT DEFAULT NULL,
  smtp_encryption TEXT NOT NULL DEFAULT 'starttls',
  smtp_username TEXT DEFAULT NULL,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_name TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT core_mail_accounts_name_nonempty_chk CHECK (length(trim(name)) BETWEEN 1 AND 120),
  CONSTRAINT core_mail_accounts_provider_chk CHECK (
    provider IN ('brevo', 'resend', 'sendgrid', 'mailgun', 'postmark', 'mailjet', 'smtp', 'msgraph')
  ),
  CONSTRAINT core_mail_accounts_encryption_chk CHECK (
    smtp_encryption IN ('ssl', 'starttls', 'none')
  ),
  CONSTRAINT core_mail_accounts_smtp_host_port_chk CHECK (
    provider <> 'smtp'
    OR (
      smtp_host IS NOT NULL
      AND length(trim(smtp_host)) > 0
      AND smtp_port IS NOT NULL
      AND smtp_port BETWEEN 1 AND 65535
      AND smtp_port <> 25
    )
  ),
  CONSTRAINT core_mail_accounts_extra_object_chk CHECK (
    extra IS NOT NULL AND jsonb_typeof(extra) = 'object'
  ),
  CONSTRAINT core_mail_accounts_msgraph_extra_chk CHECK (
    provider <> 'msgraph'
    OR (
      extra IS NOT NULL
      AND jsonb_typeof(extra) = 'object'
      AND COALESCE(trim(extra->>'tenant_id'), '') <> ''
      AND (
        trim(extra->>'tenant_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR trim(extra->>'tenant_id') ~* '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
      )
      AND COALESCE(trim(extra->>'client_id'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  )
);

-- Mise à niveau idempotente des contraintes pour Microsoft 365 (Graph) (14b_msgraph_provider)
DO $$
DECLARE
  v_provider_chk_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
  INTO v_provider_chk_def
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'core_mail_accounts'
    AND c.conname = 'core_mail_accounts_provider_chk'
  LIMIT 1;

  IF v_provider_chk_def IS NULL OR v_provider_chk_def NOT LIKE '%msgraph%' THEN
    ALTER TABLE public.core_mail_accounts
      DROP CONSTRAINT IF EXISTS core_mail_accounts_provider_chk;
    ALTER TABLE public.core_mail_accounts
      ADD CONSTRAINT core_mail_accounts_provider_chk CHECK (
        provider IN ('brevo', 'resend', 'sendgrid', 'mailgun', 'postmark', 'mailjet', 'smtp', 'msgraph')
      );
  END IF;

  ALTER TABLE public.core_mail_accounts
    DROP CONSTRAINT IF EXISTS core_mail_accounts_msgraph_extra_chk;
  ALTER TABLE public.core_mail_accounts
    ADD CONSTRAINT core_mail_accounts_msgraph_extra_chk CHECK (
      provider <> 'msgraph'
      OR (
        extra IS NOT NULL
        AND jsonb_typeof(extra) = 'object'
        AND COALESCE(trim(extra->>'tenant_id'), '') <> ''
        AND (
          trim(extra->>'tenant_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          OR trim(extra->>'tenant_id') ~* '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
        )
        AND COALESCE(trim(extra->>'client_id'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
    );
END $$;

CREATE OR REPLACE FUNCTION public._tot_core_mail_accounts_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS NULL THEN
    NEW.id := gen_random_uuid();
  END IF;
  NEW.secret_name := 'mail_account_' || NEW.id::text;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._tot_core_mail_accounts_before_write() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_core_mail_accounts_before_write ON public.core_mail_accounts;
CREATE TRIGGER trg_core_mail_accounts_before_write
  BEFORE INSERT OR UPDATE ON public.core_mail_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public._tot_core_mail_accounts_before_write();

-- -------------------------------------------------------------------------
-- 2. TABLE public.core_mail_senders (Un expéditeur par application : stk, hab, rpt, tools)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.core_mail_senders (
  app_code TEXT PRIMARY KEY,
  account_id UUID REFERENCES public.core_mail_accounts(id) ON DELETE SET NULL,
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  reply_to TEXT DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT core_mail_senders_app_code_chk CHECK (
    app_code IN ('stk', 'hab', 'rpt', 'tools')
  ),
  CONSTRAINT core_mail_senders_from_name_chk CHECK (
    length(trim(from_name)) BETWEEN 1 AND 120
  ),
  CONSTRAINT core_mail_senders_from_email_chk CHECK (
    from_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  CONSTRAINT core_mail_senders_reply_to_chk CHECK (
    reply_to IS NULL
    OR trim(reply_to) = ''
    OR reply_to ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
);

CREATE OR REPLACE FUNCTION public._tot_core_mail_senders_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.app_code := lower(trim(NEW.app_code));
  NEW.from_name := trim(NEW.from_name);
  NEW.from_email := lower(trim(NEW.from_email));
  IF NEW.reply_to IS NOT NULL AND trim(NEW.reply_to) = '' THEN
    NEW.reply_to := NULL;
  ELSIF NEW.reply_to IS NOT NULL THEN
    NEW.reply_to := lower(trim(NEW.reply_to));
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._tot_core_mail_senders_before_write() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_core_mail_senders_before_write ON public.core_mail_senders;
CREATE TRIGGER trg_core_mail_senders_before_write
  BEFORE INSERT OR UPDATE ON public.core_mail_senders
  FOR EACH ROW
  EXECUTE FUNCTION public._tot_core_mail_senders_before_write();

-- -------------------------------------------------------------------------
-- 3. TABLE public.core_mail_log (Journal des envois — écriture service_role uniquement)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.core_mail_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_code TEXT NOT NULL DEFAULT 'stk',
  account_id UUID REFERENCES public.core_mail_accounts(id) ON DELETE SET NULL,
  provider TEXT DEFAULT NULL,
  sender_email TEXT DEFAULT NULL,
  recipient_masked TEXT NOT NULL,
  recipient_count INT NOT NULL DEFAULT 1,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'transactional',
  message_id TEXT DEFAULT NULL,
  error_message TEXT DEFAULT NULL,
  user_id TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT core_mail_log_app_code_chk CHECK (
    app_code IN ('stk', 'hab', 'rpt', 'tools')
  ),
  CONSTRAINT core_mail_log_status_chk CHECK (
    status IN ('sent', 'failed', 'not_configured')
  ),
  CONSTRAINT core_mail_log_kind_chk CHECK (
    kind IN ('transactional', 'report', 'order', 'alert', 'test')
  ),
  CONSTRAINT core_mail_log_recipient_count_chk CHECK (
    recipient_count BETWEEN 1 AND 20
  )
);

CREATE INDEX IF NOT EXISTS idx_core_mail_log_created_at
  ON public.core_mail_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_mail_log_app_status
  ON public.core_mail_log (app_code, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_mail_log_user_rate
  ON public.core_mail_log (user_id, created_at DESC);

-- -------------------------------------------------------------------------
-- 4. POLITIQUES RLS & PRIVILÈGES SUR LES 3 TABLES
-- -------------------------------------------------------------------------
ALTER TABLE public.core_mail_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.core_mail_senders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.core_mail_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.core_mail_accounts FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.core_mail_senders FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.core_mail_log FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.core_mail_accounts TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.core_mail_senders TO authenticated, service_role;
GRANT SELECT ON TABLE public.core_mail_log TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON TABLE public.core_mail_log TO service_role;

DO $$
DECLARE
  v_tbl TEXT;
  v_pol RECORD;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['core_mail_accounts', 'core_mail_senders', 'core_mail_log'] LOOP
    FOR v_pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_pol.policyname, v_tbl);
    END LOOP;
  END LOOP;
END $$;

-- Politiques core_mail_accounts (administrateurs uniquement)
CREATE POLICY mail_accounts_admin_select
  ON public.core_mail_accounts
  FOR SELECT TO authenticated
  USING (public._tot_is_mail_admin());

CREATE POLICY mail_accounts_admin_insert
  ON public.core_mail_accounts
  FOR INSERT TO authenticated
  WITH CHECK (public._tot_is_mail_admin());

CREATE POLICY mail_accounts_admin_update
  ON public.core_mail_accounts
  FOR UPDATE TO authenticated
  USING (public._tot_is_mail_admin())
  WITH CHECK (public._tot_is_mail_admin());

CREATE POLICY mail_accounts_admin_delete
  ON public.core_mail_accounts
  FOR DELETE TO authenticated
  USING (public._tot_is_mail_admin());

-- Politiques core_mail_senders (administrateurs uniquement)
CREATE POLICY mail_senders_admin_select
  ON public.core_mail_senders
  FOR SELECT TO authenticated
  USING (public._tot_is_mail_admin());

CREATE POLICY mail_senders_admin_insert
  ON public.core_mail_senders
  FOR INSERT TO authenticated
  WITH CHECK (public._tot_is_mail_admin());

CREATE POLICY mail_senders_admin_update
  ON public.core_mail_senders
  FOR UPDATE TO authenticated
  USING (public._tot_is_mail_admin())
  WITH CHECK (public._tot_is_mail_admin());

CREATE POLICY mail_senders_admin_delete
  ON public.core_mail_senders
  FOR DELETE TO authenticated
  USING (public._tot_is_mail_admin());

-- Politiques core_mail_log : lecture administrateurs uniquement ; écriture via service_role (ou purge RPC)
CREATE POLICY mail_log_admin_select
  ON public.core_mail_log
  FOR SELECT TO authenticated
  USING (public._tot_is_mail_admin());

-- -------------------------------------------------------------------------
-- 5. FONCTIONS INTERNES D'ACCÈS STRICT À SUPABASE VAULT (SANS REPLI NON CHIFFRÉ)
-- -------------------------------------------------------------------------
-- Ne stocke jamais un secret dans une table non chiffrée.
-- Si l'extension Supabase Vault n'est pas activée, lève une erreur explicite.
CREATE OR REPLACE FUNCTION public._tot_write_mail_vault_secret(p_secret_name TEXT, p_secret_value TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'vault' AND table_name = 'secrets'
  ) OR NOT (
    EXISTS (
      SELECT 1 FROM information_schema.views
      WHERE table_schema = 'vault' AND table_name = 'decrypted_secrets'
    ) OR EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'vault' AND table_name = 'decrypted_secrets'
    )
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'vault' AND p.proname = 'create_secret'
  ) THEN
    RAISE EXCEPTION 'Supabase Vault indisponible : activez l''extension Vault (Database > Extensions)'
      USING ERRCODE = '0A000';
  END IF;

  EXECUTE 'SELECT id FROM vault.secrets WHERE name = $1 LIMIT 1'
    INTO v_existing_id
    USING p_secret_name;

  IF v_existing_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'vault' AND p.proname = 'update_secret'
    ) THEN
      EXECUTE 'SELECT vault.update_secret($1, $2, $3)'
        USING v_existing_id, p_secret_value, p_secret_name;
    ELSE
      EXECUTE 'DELETE FROM vault.secrets WHERE id = $1' USING v_existing_id;
      EXECUTE 'SELECT vault.create_secret($1, $2)'
        USING p_secret_value, p_secret_name;
    END IF;
  ELSE
    EXECUTE 'SELECT vault.create_secret($1, $2)'
      USING p_secret_value, p_secret_name;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._tot_write_mail_vault_secret(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._tot_read_mail_vault_secret(p_secret_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT := NULL;
BEGIN
  IF p_secret_name IS NULL OR trim(p_secret_name) = '' THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'vault' AND table_name = 'decrypted_secrets'
  ) OR EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'vault' AND table_name = 'decrypted_secrets'
  ) THEN
    BEGIN
      EXECUTE $q$
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = $1
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1
      $q$ INTO v_secret USING p_secret_name;
    EXCEPTION WHEN OTHERS THEN
      v_secret := NULL;
    END;
  END IF;

  RETURN NULLIF(trim(COALESCE(v_secret, '')), '');
END;
$$;

REVOKE ALL ON FUNCTION public._tot_read_mail_vault_secret(TEXT) FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- 6. RPC : set_mail_account_secret, mail_account_has_secret, get_mail_config, purge_mail_log
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_mail_account_secret(
  p_account_id UUID,
  p_secret TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret_name TEXT;
  v_clean_secret TEXT;
BEGIN
  IF NOT public._tot_is_mail_admin() THEN
    RAISE EXCEPTION 'Accès refusé : droits administrateur requis pour enregistrer un secret de compte e-mail.'
      USING ERRCODE = '42501';
  END IF;

  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'Identifiant de compte e-mail (p_account_id) requis.'
      USING ERRCODE = '22023';
  END IF;

  v_clean_secret := NULLIF(trim(COALESCE(p_secret, '')), '');
  IF v_clean_secret IS NULL THEN
    RAISE EXCEPTION 'Le secret (clé API ou mot de passe SMTP) ne peut pas être vide.'
      USING ERRCODE = '22023';
  END IF;

  v_secret_name := 'mail_account_' || p_account_id::text;

  UPDATE public.core_mail_accounts
  SET secret_name = v_secret_name,
      updated_at = now()
  WHERE id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compte e-mail introuvable (%).', p_account_id
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._tot_write_mail_vault_secret(v_secret_name, v_clean_secret);

  RETURN jsonb_build_object(
    'success', true,
    'account_id', p_account_id,
    'secret_name', v_secret_name,
    'has_secret', public._tot_read_mail_vault_secret(v_secret_name) IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_mail_account_secret(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_mail_account_secret(UUID, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mail_account_has_secret(
  p_account_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret_name TEXT;
BEGIN
  IF NOT public._tot_is_mail_admin() THEN
    RAISE EXCEPTION 'Accès refusé : droits administrateur requis.'
      USING ERRCODE = '42501';
  END IF;

  IF p_account_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT COALESCE(NULLIF(trim(secret_name), ''), 'mail_account_' || id::text)
  INTO v_secret_name
  FROM public.core_mail_accounts
  WHERE id = p_account_id
  LIMIT 1;

  IF v_secret_name IS NULL THEN
    RETURN false;
  END IF;

  RETURN public._tot_read_mail_vault_secret(v_secret_name) IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mail_account_has_secret(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mail_account_has_secret(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_mail_config(
  p_app_code TEXT DEFAULT 'stk'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app TEXT := COALESCE(NULLIF(lower(trim(p_app_code)), ''), 'stk');
  v_sender RECORD;
  v_secret TEXT := NULL;
  v_legacy JSONB := NULL;
  v_legacy_key TEXT := NULL;
  v_legacy_from_email TEXT := NULL;
  v_legacy_from_name TEXT := NULL;
  v_is_configured BOOLEAN := false;
  v_jwt_claims_raw TEXT;
  v_jwt_claims_role TEXT := '';
BEGIN
  v_jwt_claims_raw := NULLIF(trim(COALESCE(current_setting('request.jwt.claims', true), '')), '');
  IF v_jwt_claims_raw IS NOT NULL AND left(v_jwt_claims_raw, 1) = '{' THEN
    BEGIN
      v_jwt_claims_role := COALESCE(v_jwt_claims_raw::jsonb ->> 'role', '');
    EXCEPTION WHEN OTHERS THEN
      v_jwt_claims_role := '';
    END;
  END IF;

  -- Strictement réservé à service_role (compatible PostgREST request.jwt.claims JSON, request.jwt.claim.role et rôle SQL)
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND v_jwt_claims_role <> 'service_role'
     AND COALESCE(current_setting('role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Accès refusé : get_mail_config est strictement réservé à service_role.'
      USING ERRCODE = '42501';
  END IF;

  IF v_app NOT IN ('stk', 'hab', 'rpt', 'tools') THEN
    RAISE EXCEPTION 'Code application invalide (%). Valeurs autorisées : stk, hab, rpt, tools.', v_app
      USING ERRCODE = '22023';
  END IF;

  SELECT
    s.app_code,
    s.from_name,
    s.from_email,
    s.reply_to,
    s.is_active AS sender_active,
    a.id AS account_id,
    a.name AS account_name,
    a.provider,
    a.preset,
    a.smtp_host,
    a.smtp_port,
    a.smtp_encryption,
    a.smtp_username,
    a.extra,
    COALESCE(NULLIF(trim(a.secret_name), ''), 'mail_account_' || a.id::text) AS secret_name,
    a.is_active AS account_active
  INTO v_sender
  FROM public.core_mail_senders s
  JOIN public.core_mail_accounts a ON a.id = s.account_id
  WHERE s.app_code = v_app
    AND s.is_active = true
    AND a.is_active = true
  LIMIT 1;

  IF FOUND THEN
    v_secret := public._tot_read_mail_vault_secret(v_sender.secret_name);
    v_is_configured := (
      v_secret IS NOT NULL
      OR (
        v_sender.provider = 'smtp'
        AND v_sender.smtp_encryption = 'none'
        AND COALESCE(trim(v_sender.smtp_username), '') = ''
      )
    );

    RETURN jsonb_build_object(
      'configured', v_is_configured,
      'legacy', false,
      'app_code', v_sender.app_code,
      'account_id', v_sender.account_id,
      'account_name', v_sender.account_name,
      'provider', v_sender.provider,
      'preset', v_sender.preset,
      'smtp_host', v_sender.smtp_host,
      'smtp_port', v_sender.smtp_port,
      'smtp_encryption', v_sender.smtp_encryption,
      'smtp_username', v_sender.smtp_username,
      'extra', COALESCE(v_sender.extra, '{}'::jsonb),
      'secret', v_secret,
      'from_name', v_sender.from_name,
      'from_email', v_sender.from_email,
      'reply_to', v_sender.reply_to
    );
  END IF;

  -- Repli (fallback) sur l'ancienne configuration Brevo tant que l'application n'a pas son expéditeur actif
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_email_secret'
  ) THEN
    BEGIN
      v_legacy := public.get_email_secret();
      v_legacy_key := NULLIF(trim(COALESCE(v_legacy->>'brevo_api_key', '')), '');
      v_legacy_from_email := NULLIF(trim(COALESCE(v_legacy->>'sender_email', '')), '');
      v_legacy_from_name := NULLIF(trim(COALESCE(v_legacy->>'sender_name', '')), '');
    EXCEPTION WHEN OTHERS THEN
      v_legacy_key := NULL;
    END;
  END IF;

  IF v_legacy_from_email IS NULL THEN
    BEGIN
      SELECT NULLIF(trim(value), '') INTO v_legacy_from_email
      FROM public.core_app_settings
      WHERE key IN ('smtp_from', 'brevo_sender_email')
      ORDER BY CASE WHEN key = 'smtp_from' THEN 0 ELSE 1 END
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_legacy_from_email := NULL;
    END;
  END IF;

  IF v_legacy_from_name IS NULL THEN
    BEGIN
      SELECT NULLIF(trim(value), '') INTO v_legacy_from_name
      FROM public.core_app_settings
      WHERE key IN ('smtp_from_name', 'company_name')
      ORDER BY CASE WHEN key = 'smtp_from_name' THEN 0 ELSE 1 END
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_legacy_from_name := NULL;
    END;
  END IF;

  IF v_legacy_key IS NOT NULL THEN
    RETURN jsonb_build_object(
      'configured', true,
      'legacy', true,
      'app_code', v_app,
      'account_id', NULL,
      'account_name', 'Brevo (migré / legacy)',
      'provider', 'brevo',
      'preset', 'brevo',
      'smtp_host', NULL,
      'smtp_port', NULL,
      'smtp_encryption', 'starttls',
      'smtp_username', NULL,
      'extra', '{}'::jsonb,
      'secret', v_legacy_key,
      'from_name', COALESCE(v_legacy_from_name, 'TOT Stock Pro'),
      'from_email', COALESCE(v_legacy_from_email, 'no-reply@tot-stock.pro'),
      'reply_to', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'configured', false,
    'legacy', false,
    'app_code', v_app,
    'account_id', NULL,
    'account_name', NULL,
    'provider', NULL,
    'preset', NULL,
    'smtp_host', NULL,
    'smtp_port', NULL,
    'smtp_encryption', NULL,
    'smtp_username', NULL,
    'extra', '{}'::jsonb,
    'secret', NULL,
    'from_name', COALESCE(v_legacy_from_name, 'TOT Stock Pro'),
    'from_email', COALESCE(v_legacy_from_email, 'no-reply@tot-stock.pro'),
    'reply_to', NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_mail_config(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mail_config(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.purge_mail_log(
  p_days INT DEFAULT 90
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT := 0;
  v_days INT := GREATEST(1, COALESCE(p_days, 90));
BEGIN
  IF NOT public._tot_is_mail_admin() THEN
    RAISE EXCEPTION 'Accès refusé : droits administrateur requis pour purger le journal des e-mails.'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.core_mail_log
  WHERE created_at < (now() - make_interval(days => v_days));

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_mail_log(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_mail_log(INT) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 7. MIGRATION AUTOMATIQUE (UNE SEULE FOIS) DE L'ANCIENNE CONFIG BREVO
-- Si une clé Brevo existe dans le Vault et/ou que smtp_from / smtp_from_name sont définis,
-- crée le compte « Brevo (migré) » et l'expéditeur 'stk' sans rien écraser au second passage.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_app_and_company_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME IN ('core_app_settings', 'app_settings') THEN
    INSERT INTO public.core_company_settings (key, value, updated_at)
    VALUES (NEW.key, NEW.value, NEW.updated_at)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
  ELSIF TG_TABLE_NAME IN ('core_company_settings', 'company_settings') THEN
    INSERT INTO public.core_app_settings (key, value, updated_at)
    VALUES (NEW.key, NEW.value, NEW.updated_at)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_vault_brevo_key TEXT := NULL;
  v_old_from_email TEXT := NULL;
  v_old_from_name TEXT := NULL;
  v_migrated_account_id UUID := NULL;
BEGIN
  -- Lecture prudente du Vault s'il existe
  IF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'vault' AND table_name = 'decrypted_secrets'
  ) OR EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'vault' AND table_name = 'decrypted_secrets'
  ) THEN
    BEGIN
      EXECUTE $q$
        SELECT NULLIF(trim(decrypted_secret), '')
        FROM vault.decrypted_secrets
        WHERE name IN ('BREVO_API_KEY', 'SENDINBLUE_API_KEY', 'tot_brevo_api_key', 'email_api_key')
          AND decrypted_secret IS NOT NULL
          AND trim(decrypted_secret) <> ''
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1
      $q$ INTO v_vault_brevo_key;
    EXCEPTION WHEN OTHERS THEN
      v_vault_brevo_key := NULL;
    END;
  END IF;

  -- Lecture de smtp_from / smtp_from_name dans core_app_settings
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'core_app_settings'
  ) THEN
    BEGIN
      SELECT NULLIF(trim(value), '') INTO v_old_from_email
      FROM public.core_app_settings
      WHERE key IN ('smtp_from', 'brevo_sender_email')
        AND value IS NOT NULL
        AND trim(value) ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      ORDER BY CASE WHEN key = 'smtp_from' THEN 0 ELSE 1 END
      LIMIT 1;

      SELECT NULLIF(trim(value), '') INTO v_old_from_name
      FROM public.core_app_settings
      WHERE key IN ('smtp_from_name', 'company_name')
        AND value IS NOT NULL
        AND trim(value) <> ''
      ORDER BY CASE WHEN key = 'smtp_from_name' THEN 0 ELSE 1 END
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- Si une ancienne configuration Brevo est détectée (clé dans le Vault ou expéditeur configuré)
  IF v_vault_brevo_key IS NOT NULL OR v_old_from_email IS NOT NULL THEN
    SELECT id INTO v_migrated_account_id
    FROM public.core_mail_accounts
    WHERE name = 'Brevo (migré)' AND provider = 'brevo'
    LIMIT 1;

    IF v_migrated_account_id IS NULL THEN
      INSERT INTO public.core_mail_accounts (name, provider, preset, extra, is_active)
      VALUES ('Brevo (migré)', 'brevo', 'brevo', '{}'::jsonb, true)
      RETURNING id INTO v_migrated_account_id;
    END IF;

    IF v_vault_brevo_key IS NOT NULL AND v_migrated_account_id IS NOT NULL THEN
      PERFORM public._tot_write_mail_vault_secret(
        'mail_account_' || v_migrated_account_id::text,
        v_vault_brevo_key
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.core_mail_senders WHERE app_code = 'stk'
    ) AND v_migrated_account_id IS NOT NULL THEN
      INSERT INTO public.core_mail_senders (
        app_code,
        account_id,
        from_name,
        from_email,
        reply_to,
        is_active
      )
      VALUES (
        'stk',
        v_migrated_account_id,
        COALESCE(v_old_from_name, 'TOT Stock Pro'),
        COALESCE(v_old_from_email, 'no-reply@tot-stock.pro'),
        NULL,
        true
      );
    END IF;
  END IF;
END $$;
