-- =========================================================================
-- FICHIER GÉNÉRÉ AUTOMATIQUEMENT PAR scripts/build-sql.mjs — NE PAS MODIFIER DIRECTEMENT
-- Source de vérité : supabase-client/16_audit_trail.sql
-- Étape 16 : Journal d'audit serveur complet immuable, triggers automatiques & recherche paginée (16_audit_trail.sql)
-- =========================================================================
-- =========================================================================
-- TOT STOCK - SCRIPT 16 : JOURNAL D'AUDIT SERVEUR COMPLET (16_audit_trail.sql)
-- Schéma 2.6.0 (App 5.11.0)
-- Description :
--   1. Harmonise et verrouille en lecture/ajout seul (append-only) les tables
--      public.core_audit_logs et public.core_login_logs.
--   2. Ajoute les triggers d'immuabilité (interdiction d'UPDATE/DELETE hors purge Super Admin).
--   3. Crée le masquage automatique des secrets ('***') et les triggers d'audit
--      automatiques (INSERT/UPDATE/DELETE avec diff old -> new) sur les tables sensibles.
--   4. Crée les RPC serveur :
--      - public.log_audit_event(...)
--      - public.log_login_event(...)
--      - public.log_login_failure(...) (accessible anon + authenticated, sans secret)
--      - public.purge_audit_logs(p_older_than_days integer default 90) (rôle 0 uniquement, >= 90 j)
--      - public.search_audit_logs(...)
--      - public.search_login_logs(...)
-- Dépendances : 00..15
-- Ordre d'exécution : 16 (après 15_search_orders_movements.sql, avant 07_app_compat.sql)
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
    RAISE EXCEPTION 'Prérequis manquant (16_audit_trail.sql) : La table public.core_users est absente.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'core_roles'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (16_audit_trail.sql) : La table public.core_roles est absente.';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 1. HARMONISATION DES TABLES public.core_audit_logs & public.core_login_logs
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.core_audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  app TEXT DEFAULT 'stock',
  timestamp TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  user_id TEXT,
  user_name TEXT,
  user_trigram TEXT,
  action TEXT,
  type TEXT DEFAULT 'SYSTEM',
  category TEXT DEFAULT 'SYSTEM',
  severity TEXT DEFAULT 'INFO',
  title TEXT DEFAULT '',
  description TEXT DEFAULT '',
  ip_address TEXT,
  table_name TEXT,
  record_id TEXT,
  product_id TEXT,
  product_ref TEXT,
  quantity_changed INT,
  site_number TEXT,
  depot_name TEXT,
  badge_text TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  details JSONB DEFAULT '{}'::jsonb
);

ALTER TABLE public.core_audit_logs
  ADD COLUMN IF NOT EXISTS app TEXT DEFAULT 'stock',
  ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS user_name TEXT,
  ADD COLUMN IF NOT EXISTS user_trigram TEXT,
  ADD COLUMN IF NOT EXISTS action TEXT,
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'INFO',
  ADD COLUMN IF NOT EXISTS title TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS ip_address TEXT,
  ADD COLUMN IF NOT EXISTS table_name TEXT,
  ADD COLUMN IF NOT EXISTS record_id TEXT,
  ADD COLUMN IF NOT EXISTS product_id TEXT,
  ADD COLUMN IF NOT EXISTS product_ref TEXT,
  ADD COLUMN IF NOT EXISTS quantity_changed INT,
  ADD COLUMN IF NOT EXISTS site_number TEXT,
  ADD COLUMN IF NOT EXISTS depot_name TEXT,
  ADD COLUMN IF NOT EXISTS badge_text TEXT,
  ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb;

-- Suppression des anciennes contraintes CHECK restrictives sur category/severity si présentes
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'core_audit_logs'
      AND con.contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE public.core_audit_logs DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.core_login_logs (
  id BIGSERIAL PRIMARY KEY,
  app TEXT DEFAULT 'stock',
  user_id TEXT,
  user_name TEXT,
  user_trigram TEXT,
  identifier TEXT,
  action TEXT DEFAULT 'LOGIN_SUCCESS',
  reason TEXT,
  ip_address TEXT,
  user_agent TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  timestamp TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.core_login_logs
  ADD COLUMN IF NOT EXISTS app TEXT DEFAULT 'stock',
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS user_name TEXT,
  ADD COLUMN IF NOT EXISTS user_trigram TEXT,
  ADD COLUMN IF NOT EXISTS identifier TEXT,
  ADD COLUMN IF NOT EXISTS action TEXT DEFAULT 'LOGIN_SUCCESS',
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS ip_address TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Index de recherche haute performance
CREATE INDEX IF NOT EXISTS idx_core_audit_logs_created_desc
  ON public.core_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_audit_logs_category_created
  ON public.core_audit_logs (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_audit_logs_severity_created
  ON public.core_audit_logs (severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_audit_logs_user_created
  ON public.core_audit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_audit_logs_type_created
  ON public.core_audit_logs (type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_core_login_logs_created_desc
  ON public.core_login_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_login_logs_action_created
  ON public.core_login_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_login_logs_identifier_created
  ON public.core_login_logs (identifier, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_login_logs_user_created
  ON public.core_login_logs (user_id, created_at DESC);

-- Durcissement RLS : lecture selon permission, aucune mise à jour ni suppression directe
ALTER TABLE public.core_audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.core_audit_logs FROM anon, PUBLIC;
GRANT SELECT, INSERT ON TABLE public.core_audit_logs TO authenticated;
GRANT ALL ON TABLE public.core_audit_logs TO service_role;

DROP POLICY IF EXISTS "Authenticated read audit_logs" ON public.core_audit_logs;
CREATE POLICY "Authenticated read audit_logs"
  ON public.core_audit_logs
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_role() IN (0, 1)
    OR public.current_user_has_perm('perm_audit_view')
    OR public.current_user_has_perm('perm_menu_inventory_audit')
    OR public.current_user_has_perm('perm_view_all_login_logs')
  );

DROP POLICY IF EXISTS "Authenticated insert audit_logs" ON public.core_audit_logs;
CREATE POLICY "Authenticated insert audit_logs"
  ON public.core_audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id::text = public.current_user_id()
    OR user_id::text = auth.uid()::text
    OR auth.uid() IS NULL
  );

ALTER TABLE public.core_login_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.core_login_logs FROM anon, PUBLIC;
GRANT SELECT, INSERT ON TABLE public.core_login_logs TO authenticated;
GRANT ALL ON TABLE public.core_login_logs TO service_role;

DROP POLICY IF EXISTS "Authenticated read login_logs" ON public.core_login_logs;
CREATE POLICY "Authenticated read login_logs"
  ON public.core_login_logs
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_role() = 0
    OR public.current_user_has_perm('perm_view_all_login_logs')
    OR public.current_user_has_perm('perm_audit_view')
  );

DROP POLICY IF EXISTS "Authenticated insert login_logs" ON public.core_login_logs;
CREATE POLICY "Authenticated insert login_logs"
  ON public.core_login_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id::text = public.current_user_id()
    OR user_id::text = auth.uid()::text
    OR auth.uid() IS NULL
  );

-- -------------------------------------------------------------------------
-- 2. IMMUABILITÉ (APPEND-ONLY) SUR core_audit_logs ET core_login_logs
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tot_prevent_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND COALESCE(current_setting('tot.allow_audit_purge', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Journal d''audit immuable : toute modification ou suppression directe dans % est interdite.', TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_core_audit_logs_immutable ON public.core_audit_logs;
CREATE TRIGGER trg_core_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.core_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public._tot_prevent_audit_mutation();

DROP TRIGGER IF EXISTS trg_core_login_logs_immutable ON public.core_login_logs;
CREATE TRIGGER trg_core_login_logs_immutable
  BEFORE UPDATE OR DELETE ON public.core_login_logs
  FOR EACH ROW
  EXECUTE FUNCTION public._tot_prevent_audit_mutation();

-- -------------------------------------------------------------------------
-- 3. MASQUAGE DES SECRETS & RÉSOLUTION DE L'ACTEUR COURANT
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tot_is_sensitive_audit_key(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LOWER(COALESCE(p_key, '')) IN (
    'pin',
    'pin_hash',
    'password',
    'encrypted_password',
    'secret',
    'secret_name',
    'smtp_pass',
    'brevo_api_key',
    'api_key',
    'apikey',
    'token',
    'signed_token',
    'access_token',
    'refresh_token',
    'client_secret',
    'private_key',
    'reset_token',
    'recovery_token',
    'confirmation_token',
    'signature_data',
    'proof_photo_url',
    'photo_url',
    'logo',
    'company_logo'
  )
  OR LOWER(COALESCE(p_key, '')) LIKE '%password%'
  OR LOWER(COALESCE(p_key, '')) LIKE '%secret%'
  OR LOWER(COALESCE(p_key, '')) LIKE '%api_key%'
  OR LOWER(COALESCE(p_key, '')) LIKE '%token%';
$$;

CREATE OR REPLACE FUNCTION public._tot_mask_audit_jsonb(p_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_result JSONB := '{}'::jsonb;
  v_key TEXT;
  v_val JSONB;
  v_setting_key TEXT;
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RETURN COALESCE(p_data, '{}'::jsonb);
  END IF;

  v_setting_key := LOWER(COALESCE(p_data->>'key', ''));

  FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_data)
  LOOP
    IF public._tot_is_sensitive_audit_key(v_key) THEN
      v_result := v_result || jsonb_build_object(v_key, '***');
    ELSIF v_key = 'value' AND public._tot_is_sensitive_audit_key(v_setting_key) THEN
      v_result := v_result || jsonb_build_object(v_key, '***');
    ELSIF jsonb_typeof(v_val) = 'object' THEN
      v_result := v_result || jsonb_build_object(v_key, public._tot_mask_audit_jsonb(v_val));
    ELSE
      v_result := v_result || jsonb_build_object(v_key, v_val);
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public._tot_extract_request_ip()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_headers_raw TEXT;
  v_headers JSONB;
  v_ip TEXT;
BEGIN
  BEGIN
    v_headers_raw := current_setting('request.headers', true);
    IF v_headers_raw IS NOT NULL AND TRIM(v_headers_raw) LIKE '{%' THEN
      v_headers := v_headers_raw::jsonb;
      v_ip := COALESCE(
        NULLIF(TRIM(SPLIT_PART(COALESCE(v_headers->>'x-forwarded-for', ''), ',', 1)), ''),
        NULLIF(TRIM(v_headers->>'cf-connecting-ip'), ''),
        NULLIF(TRIM(v_headers->>'x-real-ip'), '')
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;
  RETURN v_ip;
END;
$$;

CREATE OR REPLACE FUNCTION public._tot_extract_request_user_agent()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_headers_raw TEXT;
  v_headers JSONB;
BEGIN
  BEGIN
    v_headers_raw := current_setting('request.headers', true);
    IF v_headers_raw IS NOT NULL AND TRIM(v_headers_raw) LIKE '{%' THEN
      v_headers := v_headers_raw::jsonb;
      RETURN NULLIF(LEFT(TRIM(COALESCE(v_headers->>'user-agent', '')), 300), '');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  RETURN NULL;
END;
$$;

-- -------------------------------------------------------------------------
-- 4. TRIGGER GÉNÉRIQUE D'AUDIT AUTOMATIQUE SUR LES TABLES SENSIBLES
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tot_audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_json JSONB := '{}'::jsonb;
  v_new_json JSONB := '{}'::jsonb;
  v_old_masked JSONB := '{}'::jsonb;
  v_new_masked JSONB := '{}'::jsonb;
  v_changes JSONB := '{}'::jsonb;
  v_changed_keys TEXT[] := ARRAY[]::TEXT[];
  v_key TEXT;
  v_actor_id TEXT;
  v_actor_name TEXT;
  v_actor_trigram TEXT;
  v_ip TEXT;
  v_category TEXT := 'SYSTEM';
  v_severity TEXT := 'INFO';
  v_type TEXT;
  v_record_id TEXT;
  v_label TEXT;
  v_title TEXT;
  v_description TEXT;
  v_meta JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new_json := to_jsonb(NEW);
    v_new_masked := public._tot_mask_audit_jsonb(v_new_json);
    v_record_id := COALESCE(v_new_json->>'id', v_new_json->>'key', v_new_json->>'app_code', '');
    v_label := COALESCE(
      NULLIF(TRIM(v_new_json->>'name'), ''),
      NULLIF(TRIM(v_new_json->>'reference'), ''),
      NULLIF(TRIM(v_new_json->>'email'), ''),
      NULLIF(TRIM(v_new_json->>'project_number'), ''),
      NULLIF(TRIM(v_new_json->>'key'), ''),
      NULLIF(TRIM(v_new_json->>'app_code'), ''),
      NULLIF(TRIM(v_new_json->>'sender_email'), ''),
      v_record_id
    );
  ELSIF TG_OP = 'UPDATE' THEN
    v_old_json := to_jsonb(OLD);
    v_new_json := to_jsonb(NEW);
    v_old_masked := public._tot_mask_audit_jsonb(v_old_json);
    v_new_masked := public._tot_mask_audit_jsonb(v_new_json);
    v_record_id := COALESCE(v_new_json->>'id', v_new_json->>'key', v_new_json->>'app_code', v_old_json->>'id', '');
    v_label := COALESCE(
      NULLIF(TRIM(v_new_json->>'name'), ''),
      NULLIF(TRIM(v_new_json->>'reference'), ''),
      NULLIF(TRIM(v_new_json->>'email'), ''),
      NULLIF(TRIM(v_new_json->>'project_number'), ''),
      NULLIF(TRIM(v_new_json->>'key'), ''),
      NULLIF(TRIM(v_new_json->>'app_code'), ''),
      NULLIF(TRIM(v_new_json->>'sender_email'), ''),
      v_record_id
    );

    FOR v_key IN
      SELECT DISTINCT k
      FROM (
        SELECT jsonb_object_keys(v_old_masked) AS k
        UNION
        SELECT jsonb_object_keys(v_new_masked) AS k
      ) keys
      WHERE k NOT IN ('updated_at', 'last_sync_at')
    LOOP
      IF (v_old_json->v_key) IS DISTINCT FROM (v_new_json->v_key) THEN
        IF public._tot_is_sensitive_audit_key(v_key) THEN
          v_changes := v_changes || jsonb_build_object(
            v_key,
            jsonb_build_object('old', '***', 'new', '***')
          );
        ELSE
          v_changes := v_changes || jsonb_build_object(
            v_key,
            jsonb_build_object(
              'old', COALESCE(v_old_masked->v_key, 'null'::jsonb),
              'new', COALESCE(v_new_masked->v_key, 'null'::jsonb)
            )
          );
        END IF;
        v_changed_keys := array_append(v_changed_keys, v_key);
      END IF;
    END LOOP;

    -- Ignorer les mises à jour techniques sans changement métier
    IF v_changes = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_old_json := to_jsonb(OLD);
    v_old_masked := public._tot_mask_audit_jsonb(v_old_json);
    v_record_id := COALESCE(v_old_json->>'id', v_old_json->>'key', v_old_json->>'app_code', '');
    v_label := COALESCE(
      NULLIF(TRIM(v_old_json->>'name'), ''),
      NULLIF(TRIM(v_old_json->>'reference'), ''),
      NULLIF(TRIM(v_old_json->>'email'), ''),
      NULLIF(TRIM(v_old_json->>'project_number'), ''),
      NULLIF(TRIM(v_old_json->>'key'), ''),
      NULLIF(TRIM(v_old_json->>'app_code'), ''),
      NULLIF(TRIM(v_old_json->>'sender_email'), ''),
      v_record_id
    );
  END IF;

  -- Catégorie selon la table
  CASE TG_TABLE_NAME
    WHEN 'core_users' THEN v_category := 'USERS';
    WHEN 'core_roles' THEN v_category := 'SECURITY';
    WHEN 'core_license_config' THEN v_category := 'SECURITY';
    WHEN 'core_departments' THEN v_category := 'CONFIG';
    WHEN 'core_projects' THEN v_category := 'CONFIG';
    WHEN 'core_app_settings' THEN v_category := 'CONFIG';
    WHEN 'core_company_settings' THEN v_category := 'CONFIG';
    WHEN 'core_mail_accounts' THEN v_category := 'CONFIG';
    WHEN 'core_mail_senders' THEN v_category := 'CONFIG';
    WHEN 'stk_depots' THEN v_category := 'DEPOTS';
    WHEN 'stk_products' THEN v_category := 'CATALOG';
    WHEN 'stk_categories' THEN v_category := 'CATALOG';
    WHEN 'stk_sub_categories' THEN v_category := 'CATALOG';
    ELSE v_category := 'SYSTEM';
  END CASE;

  -- Sévérité selon l'opération et les colonnes touchées
  IF TG_OP = 'DELETE' THEN
    v_severity := 'WARNING';
  ELSIF TG_TABLE_NAME IN ('core_roles', 'core_license_config', 'core_mail_accounts') THEN
    v_severity := 'WARNING';
  ELSIF TG_TABLE_NAME = 'core_users' AND TG_OP = 'UPDATE' AND (
    'role_id' = ANY(v_changed_keys)
    OR 'is_blocked' = ANY(v_changed_keys)
    OR 'pin' = ANY(v_changed_keys)
    OR 'pin_hash' = ANY(v_changed_keys)
    OR 'allowed_depots' = ANY(v_changed_keys)
  ) THEN
    v_severity := 'WARNING';
  ELSE
    v_severity := 'INFO';
  END IF;

  v_type := UPPER(TG_TABLE_NAME) || '_' || TG_OP;

  -- Résolution de l'acteur courant
  BEGIN
    IF auth.uid() IS NOT NULL THEN
      SELECT id::text, name, trigram
      INTO v_actor_id, v_actor_name, v_actor_trigram
      FROM public.core_users
      WHERE auth_user_id = auth.uid()
      LIMIT 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_actor_id := NULL;
  END;

  IF v_actor_id IS NULL THEN
    v_actor_id := COALESCE(NULLIF(public.current_user_id(), ''), 'system');
  END IF;
  IF v_actor_name IS NULL OR TRIM(v_actor_name) = '' THEN
    v_actor_name := 'Système';
  END IF;

  v_ip := public._tot_extract_request_ip();

  IF TG_OP = 'INSERT' THEN
    v_title := format('[%s] Création : %s', TG_TABLE_NAME, COALESCE(NULLIF(v_label, ''), '#'));
    v_description := format('Création dans %s (%s)', TG_TABLE_NAME, COALESCE(NULLIF(v_label, ''), v_record_id));
    v_meta := jsonb_build_object(
      'table', TG_TABLE_NAME,
      'operation', 'INSERT',
      'record_id', v_record_id,
      'label', v_label,
      'snapshot', v_new_masked
    );
  ELSIF TG_OP = 'UPDATE' THEN
    v_title := format('[%s] Modification : %s', TG_TABLE_NAME, COALESCE(NULLIF(v_label, ''), '#'));
    v_description := format(
      'Modification dans %s (%s) — champs : %s',
      TG_TABLE_NAME,
      COALESCE(NULLIF(v_label, ''), v_record_id),
      array_to_string(v_changed_keys, ', ')
    );
    v_meta := jsonb_build_object(
      'table', TG_TABLE_NAME,
      'operation', 'UPDATE',
      'record_id', v_record_id,
      'label', v_label,
      'changed_fields', to_jsonb(v_changed_keys),
      'changes', v_changes
    );
  ELSE
    v_title := format('[%s] Suppression : %s', TG_TABLE_NAME, COALESCE(NULLIF(v_label, ''), '#'));
    v_description := format('Suppression dans %s (%s)', TG_TABLE_NAME, COALESCE(NULLIF(v_label, ''), v_record_id));
    v_meta := jsonb_build_object(
      'table', TG_TABLE_NAME,
      'operation', 'DELETE',
      'record_id', v_record_id,
      'label', v_label,
      'snapshot', v_old_masked
    );
  END IF;

  INSERT INTO public.core_audit_logs (
    id, app, timestamp, created_at,
    user_id, user_name, user_trigram,
    action, type, category, severity,
    title, description, ip_address,
    table_name, record_id,
    meta, details
  ) VALUES (
    gen_random_uuid()::text,
    'stock',
    now(),
    now(),
    v_actor_id,
    v_actor_name,
    v_actor_trigram,
    v_type,
    v_type,
    v_category,
    v_severity,
    v_title,
    v_description,
    v_ip,
    TG_TABLE_NAME,
    v_record_id,
    v_meta,
    v_meta
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Attachement idempotent des triggers d'audit sur toutes les tables sensibles
DO $$
DECLARE
  v_tbl TEXT;
  v_trg TEXT;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'core_users',
    'core_roles',
    'core_departments',
    'core_projects',
    'stk_depots',
    'stk_products',
    'stk_categories',
    'stk_sub_categories',
    'core_app_settings',
    'core_company_settings',
    'core_license_config',
    'core_mail_accounts',
    'core_mail_senders'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_tbl
    ) THEN
      v_trg := 'trg_audit_' || v_tbl;
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_trg, v_tbl);
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._tot_audit_row_change()',
        v_trg,
        v_tbl
      );
    END IF;
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 5. RPC : public.log_audit_event
-- Journalisation explicite d'événements applicatifs (exports, rapports, sécurité)
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.log_audit_event(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_category TEXT,
  p_type TEXT,
  p_title TEXT,
  p_description TEXT DEFAULT NULL,
  p_severity TEXT DEFAULT 'INFO',
  p_meta JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_name TEXT;
  v_caller_trigram TEXT;
  v_is_blocked BOOLEAN;
  v_is_service BOOLEAN := false;
  v_norm_cat TEXT;
  v_norm_sev TEXT;
  v_norm_type TEXT;
  v_safe_meta JSONB;
  v_ip TEXT;
  v_new_id TEXT;
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_setting('role', true) = 'service_role'
     OR (
       COALESCE(NULLIF(trim(current_setting('request.jwt.claims', true)), ''), '') LIKE '{%'
       AND COALESCE((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') = 'service_role'
     ) THEN
    v_is_service := true;
    v_caller_id := 'service_role';
    v_caller_name := 'Système';
  ELSE
    SELECT id::text, name, trigram, is_blocked
    INTO v_caller_id, v_caller_name, v_caller_trigram, v_is_blocked
    FROM public.core_users
    WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
    LIMIT 1;

    IF v_caller_id IS NULL OR v_is_blocked = TRUE THEN
      RAISE EXCEPTION 'Utilisateur non authentifié ou compte bloqué' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_norm_cat := UPPER(TRIM(COALESCE(p_category, 'SYSTEM')));
  IF v_norm_cat NOT IN ('USERS', 'CONFIG', 'CATALOG', 'DEPOTS', 'ORDERS', 'MOVEMENTS', 'SECURITY', 'EXPORTS', 'SYSTEM', 'SCANS') THEN
    v_norm_cat := 'SYSTEM';
  END IF;

  v_norm_sev := UPPER(TRIM(COALESCE(p_severity, 'INFO')));
  IF v_norm_sev NOT IN ('INFO', 'WARNING', 'CRITICAL') THEN
    v_norm_sev := 'INFO';
  END IF;

  v_norm_type := COALESCE(NULLIF(TRIM(p_type), ''), 'APP_EVENT');
  v_safe_meta := public._tot_mask_audit_jsonb(COALESCE(p_meta, '{}'::jsonb));
  v_ip := public._tot_extract_request_ip();
  v_new_id := gen_random_uuid()::text;

  INSERT INTO public.core_audit_logs (
    id, app, timestamp, created_at,
    user_id, user_name, user_trigram,
    action, type, category, severity,
    title, description, ip_address,
    meta, details
  ) VALUES (
    v_new_id,
    'stock',
    now(),
    now(),
    v_caller_id,
    v_caller_name,
    v_caller_trigram,
    v_norm_type,
    v_norm_type,
    v_norm_cat,
    v_norm_sev,
    LEFT(COALESCE(NULLIF(TRIM(p_title), ''), v_norm_type), 300),
    LEFT(COALESCE(p_description, ''), 1000),
    v_ip,
    v_safe_meta,
    v_safe_meta
  );

  RETURN jsonb_build_object('ok', true, 'id', v_new_id);
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit_event(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_audit_event(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 6. RPC : public.log_login_event & public.log_login_failure
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.log_login_event(TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.log_login_event(
  p_action TEXT,
  p_meta JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_name TEXT;
  v_caller_trigram TEXT;
  v_caller_email TEXT;
  v_is_blocked BOOLEAN;
  v_norm_action TEXT;
  v_safe_meta JSONB;
  v_ip TEXT;
  v_ua TEXT;
  v_new_id BIGINT;
BEGIN
  SELECT id::text, name, trigram, email, is_blocked
  INTO v_caller_id, v_caller_name, v_caller_trigram, v_caller_email, v_is_blocked
  FROM public.core_users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_caller_id IS NULL THEN
    IF current_setting('request.jwt.claim.role', true) = 'service_role'
       OR current_setting('role', true) = 'service_role' THEN
      v_caller_id := COALESCE(NULLIF(TRIM(p_meta->>'user_id'), ''), 'service_role');
      v_caller_name := COALESCE(NULLIF(TRIM(p_meta->>'user_name'), ''), 'Système');
    ELSE
      RAISE EXCEPTION 'Utilisateur non authentifié' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_norm_action := UPPER(TRIM(COALESCE(p_action, 'LOGIN_SUCCESS')));
  IF v_norm_action NOT IN ('LOGIN_SUCCESS', 'LOGOUT', 'SESSION_RESTORED') THEN
    v_norm_action := 'LOGIN_SUCCESS';
  END IF;

  v_safe_meta := public._tot_mask_audit_jsonb(COALESCE(p_meta, '{}'::jsonb));
  v_ip := public._tot_extract_request_ip();
  v_ua := COALESCE(NULLIF(TRIM(v_safe_meta->>'user_agent'), ''), public._tot_extract_request_user_agent());

  INSERT INTO public.core_login_logs (
    app, user_id, user_name, user_trigram, identifier,
    action, ip_address, user_agent, meta, timestamp, created_at
  ) VALUES (
    'stock',
    v_caller_id,
    v_caller_name,
    v_caller_trigram,
    COALESCE(v_caller_email, v_caller_trigram, v_caller_name),
    v_norm_action,
    v_ip,
    v_ua,
    v_safe_meta,
    now(),
    now()
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('ok', true, 'id', v_new_id, 'action', v_norm_action);
END;
$$;

REVOKE ALL ON FUNCTION public.log_login_event(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_login_event(TEXT, JSONB) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.log_login_failure(TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.log_login_failure(
  p_identifier TEXT,
  p_reason TEXT DEFAULT NULL,
  p_meta JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_identifier TEXT;
  v_matched_id TEXT;
  v_matched_name TEXT;
  v_matched_trigram TEXT;
  v_safe_meta JSONB;
  v_ip TEXT;
  v_ua TEXT;
  v_recent_failures INT := 0;
  v_new_id BIGINT;
BEGIN
  v_clean_identifier := LEFT(TRIM(COALESCE(p_identifier, '')), 160);
  IF v_clean_identifier = '' THEN
    v_clean_identifier := 'unknown';
  END IF;

  -- Sécurité : si l'identifiant ressemble à un code PIN numérique pur (4 à 8 chiffres), on ne stocke jamais les chiffres
  IF v_clean_identifier ~ '^[0-9]{4,8}$' THEN
    v_clean_identifier := '[PIN]';
  END IF;

  SELECT id::text, name, trigram
  INTO v_matched_id, v_matched_name, v_matched_trigram
  FROM public.core_users
  WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(v_clean_identifier)
     OR UPPER(TRIM(COALESCE(trigram, ''))) = UPPER(v_clean_identifier)
     OR LOWER(TRIM(COALESCE(name, ''))) = LOWER(v_clean_identifier)
  LIMIT 1;

  v_safe_meta := public._tot_mask_audit_jsonb(COALESCE(p_meta, '{}'::jsonb));
  v_ip := public._tot_extract_request_ip();
  v_ua := COALESCE(NULLIF(TRIM(v_safe_meta->>'user_agent'), ''), public._tot_extract_request_user_agent());

  INSERT INTO public.core_login_logs (
    app, user_id, user_name, user_trigram, identifier,
    action, reason, ip_address, user_agent, meta, timestamp, created_at
  ) VALUES (
    'stock',
    v_matched_id,
    COALESCE(v_matched_name, v_clean_identifier),
    v_matched_trigram,
    v_clean_identifier,
    'LOGIN_FAILED',
    LEFT(COALESCE(NULLIF(TRIM(p_reason), ''), 'INVALID_CREDENTIALS'), 160),
    v_ip,
    v_ua,
    v_safe_meta || jsonb_build_object('identifier', v_clean_identifier),
    now(),
    now()
  )
  RETURNING id INTO v_new_id;

  -- Détection d'échecs répétés (>= 5 sur les dernières 24h pour le même identifiant)
  SELECT COUNT(*)::INT
  INTO v_recent_failures
  FROM public.core_login_logs
  WHERE action = 'LOGIN_FAILED'
    AND LOWER(COALESCE(identifier, user_name, '')) = LOWER(v_clean_identifier)
    AND created_at >= now() - INTERVAL '24 hours';

  IF v_recent_failures >= 5 THEN
    INSERT INTO public.core_audit_logs (
      id, app, timestamp, created_at,
      user_id, user_name, user_trigram,
      action, type, category, severity,
      title, description, ip_address,
      meta, details
    ) VALUES (
      gen_random_uuid()::text,
      'stock',
      now(),
      now(),
      COALESCE(v_matched_id, 'anonymous'),
      COALESCE(v_matched_name, v_clean_identifier),
      v_matched_trigram,
      'LOGIN_REPEATED_FAILURE',
      'LOGIN_REPEATED_FAILURE',
      'SECURITY',
      CASE WHEN v_recent_failures >= 10 THEN 'CRITICAL' ELSE 'WARNING' END,
      format('Échecs de connexion répétés (%s) : %s', v_recent_failures, v_clean_identifier),
      format('%s tentatives de connexion échouées sur 24h pour l''identifiant %s', v_recent_failures, v_clean_identifier),
      v_ip,
      jsonb_build_object(
        'identifier', v_clean_identifier,
        'failure_count_24h', v_recent_failures,
        'reason', COALESCE(NULLIF(TRIM(p_reason), ''), 'INVALID_CREDENTIALS')
      ),
      jsonb_build_object(
        'identifier', v_clean_identifier,
        'failure_count_24h', v_recent_failures
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_new_id,
    'recent_failures', v_recent_failures
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_login_failure(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_login_failure(TEXT, TEXT, JSONB) TO anon, authenticated, service_role;

-- -------------------------------------------------------------------------
-- 7. RPC : public.purge_audit_logs (Super Admin rôle 0 uniquement, >= 90 jours)
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.purge_audit_logs(INTEGER);

CREATE OR REPLACE FUNCTION public.purge_audit_logs(
  p_older_than_days INTEGER DEFAULT 90
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_name TEXT;
  v_caller_trigram TEXT;
  v_caller_role INT;
  v_is_blocked BOOLEAN;
  v_is_service BOOLEAN := false;
  v_days INT;
  v_cutoff TIMESTAMPTZ;
  v_deleted_audit BIGINT := 0;
  v_deleted_login BIGINT := 0;
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_setting('role', true) = 'service_role'
     OR (
       COALESCE(NULLIF(trim(current_setting('request.jwt.claims', true)), ''), '') LIKE '{%'
       AND COALESCE((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') = 'service_role'
     ) THEN
    v_is_service := true;
    v_caller_id := 'service_role';
    v_caller_name := 'Super Admin (Service)';
    v_caller_role := 0;
  ELSE
    SELECT id::text, name, trigram, role_id, is_blocked
    INTO v_caller_id, v_caller_name, v_caller_trigram, v_caller_role, v_is_blocked
    FROM public.core_users
    WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
    LIMIT 1;

    IF v_caller_id IS NULL OR v_is_blocked = TRUE OR v_caller_role IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'Accès refusé : seul le Super Administrateur (rôle 0) peut purger le journal d''audit.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_days := COALESCE(p_older_than_days, 90);
  IF v_days < 90 THEN
    RAISE EXCEPTION 'Rétention minimale obligatoire : la purge du journal d''audit exige une ancienneté d''au moins 90 jours (reçu : % jours).', v_days
      USING ERRCODE = '22023';
  END IF;

  v_cutoff := now() - make_interval(days => v_days);

  -- Autoriser temporairement la suppression dans la transaction courante
  PERFORM set_config('tot.allow_audit_purge', 'on', true);

  DELETE FROM public.core_audit_logs
  WHERE COALESCE(created_at, timestamp) < v_cutoff;
  GET DIAGNOSTICS v_deleted_audit = ROW_COUNT;

  DELETE FROM public.core_login_logs
  WHERE COALESCE(created_at, timestamp) < v_cutoff;
  GET DIAGNOSTICS v_deleted_login = ROW_COUNT;

  PERFORM set_config('tot.allow_audit_purge', 'off', true);

  -- Tracer la purge elle-même de manière immuable
  INSERT INTO public.core_audit_logs (
    id, app, timestamp, created_at,
    user_id, user_name, user_trigram,
    action, type, category, severity,
    title, description, ip_address,
    meta, details
  ) VALUES (
    gen_random_uuid()::text,
    'stock',
    now(),
    now(),
    v_caller_id,
    v_caller_name,
    v_caller_trigram,
    'AUDIT_PURGE',
    'AUDIT_PURGE',
    'SECURITY',
    'WARNING',
    format('Purge du journal d''audit (> %s jours)', v_days),
    format('Suppression de %s événements d''audit et %s journaux de connexion antérieurs au %s', v_deleted_audit, v_deleted_login, to_char(v_cutoff, 'YYYY-MM-DD HH24:MI')),
    public._tot_extract_request_ip(),
    jsonb_build_object(
      'older_than_days', v_days,
      'cutoff', v_cutoff,
      'deleted_audit_logs', v_deleted_audit,
      'deleted_login_logs', v_deleted_login,
      'total_deleted', v_deleted_audit + v_deleted_login
    ),
    jsonb_build_object(
      'older_than_days', v_days,
      'deleted_audit_logs', v_deleted_audit,
      'deleted_login_logs', v_deleted_login,
      'total_deleted', v_deleted_audit + v_deleted_login
    )
  );

  RETURN jsonb_build_object(
    'older_than_days', v_days,
    'deleted_audit_logs', v_deleted_audit,
    'deleted_login_logs', v_deleted_login,
    'total_deleted', v_deleted_audit + v_deleted_login
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_audit_logs(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_audit_logs(INTEGER) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 8. RPC : public.search_audit_logs & public.search_login_logs
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_audit_logs(
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER
);

CREATE OR REPLACE FUNCTION public.search_audit_logs(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_user TEXT DEFAULT NULL,
  p_type TEXT DEFAULT NULL,
  p_severity TEXT DEFAULT NULL,
  p_text TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  total_count BIGINT,
  row_data JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_role INT;
  v_is_blocked BOOLEAN;
  v_is_service BOOLEAN := false;
  v_safe_limit INT;
  v_safe_offset INT;
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_setting('role', true) = 'service_role'
     OR (
       COALESCE(NULLIF(trim(current_setting('request.jwt.claims', true)), ''), '') LIKE '{%'
       AND COALESCE((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') = 'service_role'
     ) THEN
    v_is_service := true;
    v_caller_role := 0;
  ELSE
    SELECT id::text, role_id, is_blocked
    INTO v_caller_id, v_caller_role, v_is_blocked
    FROM public.core_users
    WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
    LIMIT 1;

    IF v_caller_id IS NULL OR v_is_blocked = TRUE THEN
      RAISE EXCEPTION 'Utilisateur non authentifié ou compte bloqué' USING ERRCODE = '42501';
    END IF;

    IF v_caller_role NOT IN (0, 1)
       AND NOT public.current_user_has_perm('perm_audit_view') THEN
      RAISE EXCEPTION 'Permission refusée : perm_audit_view requise pour consulter le journal d''audit.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_safe_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 5000);
  v_safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  RETURN QUERY
  WITH filtered AS (
    SELECT
      a.id,
      COALESCE(a.app, 'stock') AS app,
      COALESCE(a.created_at, a.timestamp, now()) AS created_at,
      a.user_id,
      COALESCE(a.user_name, 'Système') AS user_name,
      a.user_trigram,
      COALESCE(a.type, a.action, 'SYSTEM') AS type,
      COALESCE(a.action, a.type, 'SYSTEM') AS action,
      COALESCE(a.category, 'SYSTEM') AS category,
      COALESCE(a.severity, 'INFO') AS severity,
      COALESCE(NULLIF(a.title, ''), COALESCE(a.action, a.type, 'Événement')) AS title,
      COALESCE(a.description, '') AS description,
      a.ip_address,
      a.table_name,
      a.record_id,
      a.product_id,
      a.product_ref,
      a.quantity_changed,
      a.site_number,
      a.depot_name,
      public._tot_mask_audit_jsonb(COALESCE(NULLIF(a.meta, '{}'::jsonb), COALESCE(a.details, '{}'::jsonb))) AS meta
    FROM public.core_audit_logs a
    WHERE (p_from IS NULL OR COALESCE(a.created_at, a.timestamp) >= p_from)
      AND (p_to IS NULL OR COALESCE(a.created_at, a.timestamp) <= p_to)
      AND (
        p_category IS NULL
        OR TRIM(p_category) = ''
        OR UPPER(TRIM(p_category)) = 'ALL'
        OR UPPER(COALESCE(a.category, 'SYSTEM')) = UPPER(TRIM(p_category))
      )
      AND (
        p_user IS NULL
        OR TRIM(p_user) = ''
        OR UPPER(TRIM(p_user)) = 'ALL'
        OR COALESCE(a.user_id, '') = TRIM(p_user)
        OR COALESCE(a.user_name, '') ILIKE '%' || TRIM(p_user) || '%'
        OR COALESCE(a.user_trigram, '') ILIKE '%' || TRIM(p_user) || '%'
      )
      AND (
        p_type IS NULL
        OR TRIM(p_type) = ''
        OR UPPER(TRIM(p_type)) = 'ALL'
        OR COALESCE(a.type, '') ILIKE '%' || TRIM(p_type) || '%'
        OR COALESCE(a.action, '') ILIKE '%' || TRIM(p_type) || '%'
      )
      AND (
        p_severity IS NULL
        OR TRIM(p_severity) = ''
        OR UPPER(TRIM(p_severity)) = 'ALL'
        OR UPPER(COALESCE(a.severity, 'INFO')) = UPPER(TRIM(p_severity))
      )
      AND (
        p_text IS NULL
        OR TRIM(p_text) = ''
        OR COALESCE(a.title, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(a.description, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(a.user_name, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(a.user_trigram, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(a.type, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(a.action, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(a.table_name, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(a.record_id, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(a.product_ref, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(a.site_number, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(a.depot_name, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(a.meta::text, '') ILIKE '%' || TRIM(p_text) || '%'
      )
  )
  SELECT
    COUNT(*) OVER()::BIGINT AS total_count,
    to_jsonb(f) AS row_data
  FROM filtered f
  ORDER BY f.created_at DESC, f.id DESC
  LIMIT v_safe_limit
  OFFSET v_safe_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.search_audit_logs(
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_audit_logs(
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER
) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.search_login_logs(
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, INTEGER
);

CREATE OR REPLACE FUNCTION public.search_login_logs(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_user TEXT DEFAULT NULL,
  p_action TEXT DEFAULT NULL,
  p_text TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  total_count BIGINT,
  row_data JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_role INT;
  v_is_blocked BOOLEAN;
  v_is_service BOOLEAN := false;
  v_safe_limit INT;
  v_safe_offset INT;
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_setting('role', true) = 'service_role'
     OR (
       COALESCE(NULLIF(trim(current_setting('request.jwt.claims', true)), ''), '') LIKE '{%'
       AND COALESCE((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') = 'service_role'
     ) THEN
    v_is_service := true;
    v_caller_role := 0;
  ELSE
    SELECT id::text, role_id, is_blocked
    INTO v_caller_id, v_caller_role, v_is_blocked
    FROM public.core_users
    WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
    LIMIT 1;

    IF v_caller_id IS NULL OR v_is_blocked = TRUE THEN
      RAISE EXCEPTION 'Utilisateur non authentifié ou compte bloqué' USING ERRCODE = '42501';
    END IF;

    IF v_caller_role <> 0
       AND NOT public.current_user_has_perm('perm_view_all_login_logs')
       AND NOT public.current_user_has_perm('perm_audit_view') THEN
      RAISE EXCEPTION 'Permission refusée : perm_view_all_login_logs requise pour consulter le journal des connexions.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_safe_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 5000);
  v_safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  RETURN QUERY
  WITH filtered AS (
    SELECT
      l.id::text AS id,
      COALESCE(l.app, 'stock') AS app,
      COALESCE(l.created_at, l.timestamp, now()) AS created_at,
      l.user_id,
      COALESCE(l.user_name, l.identifier, 'Inconnu') AS user_name,
      l.user_trigram,
      COALESCE(l.identifier, l.user_name, '') AS identifier,
      COALESCE(l.action, 'LOGIN_SUCCESS') AS action,
      l.reason,
      l.ip_address,
      l.user_agent,
      public._tot_mask_audit_jsonb(COALESCE(l.meta, '{}'::jsonb)) AS meta,
      COUNT(*) FILTER (WHERE l.action = 'LOGIN_FAILED') OVER (
        PARTITION BY LOWER(COALESCE(NULLIF(l.identifier, ''), COALESCE(l.user_name, '')))
      )::INT AS failure_count_for_identifier
    FROM public.core_login_logs l
    WHERE (p_from IS NULL OR COALESCE(l.created_at, l.timestamp) >= p_from)
      AND (p_to IS NULL OR COALESCE(l.created_at, l.timestamp) <= p_to)
      AND (
        p_user IS NULL
        OR TRIM(p_user) = ''
        OR UPPER(TRIM(p_user)) = 'ALL'
        OR COALESCE(l.user_id, '') = TRIM(p_user)
        OR COALESCE(l.user_name, '') ILIKE '%' || TRIM(p_user) || '%'
        OR COALESCE(l.user_trigram, '') ILIKE '%' || TRIM(p_user) || '%'
        OR COALESCE(l.identifier, '') ILIKE '%' || TRIM(p_user) || '%'
      )
      AND (
        p_action IS NULL
        OR TRIM(p_action) = ''
        OR UPPER(TRIM(p_action)) = 'ALL'
        OR UPPER(COALESCE(l.action, '')) = UPPER(TRIM(p_action))
      )
      AND (
        p_text IS NULL
        OR TRIM(p_text) = ''
        OR COALESCE(l.user_name, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(l.identifier, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(l.action, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(l.reason, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(l.ip_address, '') ILIKE '%' || TRIM(p_text) || '%'
        OR COALESCE(l.user_agent, '') ILIKE '%' || TRIM(p_text) || '%'
      )
  )
  SELECT
    COUNT(*) OVER()::BIGINT AS total_count,
    to_jsonb(f) AS row_data
  FROM filtered f
  ORDER BY f.created_at DESC, f.id DESC
  LIMIT v_safe_limit
  OFFSET v_safe_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.search_login_logs(
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_login_logs(
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, INTEGER
) TO authenticated, service_role;
