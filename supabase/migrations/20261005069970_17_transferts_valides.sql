-- =========================================================================
-- FICHIER GÉNÉRÉ AUTOMATIQUEMENT PAR scripts/build-sql.mjs — NE PAS MODIFIER DIRECTEMENT
-- Source de vérité : supabase-client/17_transferts_valides.sql
-- Étape 17 : Transferts validés à la réception, responsables de dépôt (stk_depot_holders, stk_transfers) & droits fins (17_transferts_valides.sql)
-- =========================================================================
-- =========================================================================
-- TOT STOCK - SCRIPT 17 : TRANSFERTS VALIDÉS À LA RÉCEPTION, RESPONSABLES DE DÉPÔT & DROITS FINS (17_transferts_valides.sql)
-- Schéma 2.7.0 (App 5.12.0)
-- Description :
--   1. Ajoute les 3 permissions fines aux rôles Administrateur (1) et Responsable Logistique (6) :
--      - perm_stock_transfer_store (Transférer depuis un dépôt magasin fixe)
--      - perm_stock_receive_all (Valider les réceptions de tous les dépôts / arbitrer les litiges)
--      - perm_report_stock_levels (Rapports de niveau de stock)
--   2. Crée la table public.stk_depot_holders (depot_id, user_id, can_send, can_receive)
--      et la RPC public.set_depot_holders(p_depot_id, p_holders jsonb).
--   3. Crée la table public.stk_transfers et le workflow complet de transfert avec validation :
--      - public.send_stock_transfer(p_batch_id, p_source_depot, p_dest_depot, p_items, p_reason)
--      - public.receive_stock_transfer(p_transfer_id, p_items, p_note)
--      - public.confirm_stock_transfer_adjustment(p_transfer_id, p_confirm, p_comment)
--      - public.resolve_transfer_dispute(p_transfer_id, p_action, p_comment)
--      - public.reject_stock_transfer(p_transfer_id, p_note)
--      - public.cancel_stock_transfer(p_transfer_id, p_note)
--      - public.list_overdue_transfers(p_hours)
--      - Redirection de public.transfer_stock_batch vers public.send_stock_transfer
--   4. Crée la RPC public.get_stock_levels_report(p_depot, p_only_low) réservée à
--      perm_report_stock_levels ou aux rôles 0/1.
-- Ordre d'exécution : 17 (après 16_audit_trail.sql, avant 07_app_compat.sql)
-- Rejouable / Idempotent : oui
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
    RAISE EXCEPTION 'Prérequis manquant (17_transferts_valides.sql) : La table public.core_users est absente.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stk_depots'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (17_transferts_valides.sql) : La table public.stk_depots est absente.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stk_products'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (17_transferts_valides.sql) : La table public.stk_products est absente.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stk_stock_levels'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (17_transferts_valides.sql) : La table public.stk_stock_levels est absente.';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 1. NOUVELLES PERMISSIONS SUR LES RÔLES 0, 1 (Administrateur) ET 6 (Responsable Logistique)
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_perm TEXT;
  v_role_id INT;
BEGIN
  FOREACH v_role_id IN ARRAY ARRAY[0, 1, 6] LOOP
    FOREACH v_perm IN ARRAY ARRAY[
      'perm_stock_transfer_store',
      'perm_stock_receive_all',
      'perm_report_stock_levels'
    ] LOOP
      UPDATE public.core_roles
      SET permissions = array_append(COALESCE(permissions, ARRAY[]::TEXT[]), v_perm)
      WHERE id = v_role_id
        AND NOT ('*' = ANY(COALESCE(permissions, ARRAY[]::TEXT[])))
        AND NOT (v_perm = ANY(COALESCE(permissions, ARRAY[]::TEXT[])));
    END LOOP;
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 2. TABLE public.stk_depot_holders & RPC public.set_depot_holders
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stk_depot_holders (
  depot_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  can_send BOOLEAN NOT NULL DEFAULT true,
  can_receive BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (depot_id, user_id)
);

ALTER TABLE public.stk_depot_holders
  ADD COLUMN IF NOT EXISTS can_send BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_receive BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_stk_depot_holders_depot_id ON public.stk_depot_holders(depot_id);
CREATE INDEX IF NOT EXISTS idx_stk_depot_holders_user_id ON public.stk_depot_holders(user_id);

ALTER TABLE public.stk_depot_holders ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stk_depot_holders'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.stk_depot_holders', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "stk_depot_holders_select_authenticated"
  ON public.stk_depot_holders
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON TABLE public.stk_depot_holders FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.stk_depot_holders FROM authenticated;
GRANT SELECT ON TABLE public.stk_depot_holders TO authenticated;
GRANT ALL ON TABLE public.stk_depot_holders TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_tot_audit_row_change'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_stk_depot_holders ON public.stk_depot_holders';
    EXECUTE 'CREATE TRIGGER trg_audit_stk_depot_holders AFTER INSERT OR UPDATE OR DELETE ON public.stk_depot_holders FOR EACH ROW EXECUTE FUNCTION public._tot_audit_row_change()';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._tot_resolve_depot_record(p_depot_ref TEXT)
RETURNS TABLE (
  depot_id TEXT,
  depot_name TEXT,
  depot_type TEXT,
  is_active BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref TEXT := NULLIF(TRIM(COALESCE(p_depot_ref, '')), '');
BEGIN
  IF v_ref IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    d.id::text AS depot_id,
    d.name AS depot_name,
    UPPER(COALESCE(NULLIF(TRIM(d.type), ''), 'FIXED')) AS depot_type,
    COALESCE(d.is_active, true) AS is_active
  FROM public.stk_depots d
  WHERE d.id::text = v_ref
     OR LOWER(TRIM(d.name)) = LOWER(v_ref)
  ORDER BY (CASE WHEN d.id::text = v_ref THEN 0 ELSE 1 END)
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public._tot_resolve_depot_record(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._tot_resolve_depot_record(TEXT) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.set_depot_holders(TEXT, JSONB) CASCADE;
CREATE OR REPLACE FUNCTION public.set_depot_holders(
  p_depot_id TEXT,
  p_holders JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_role INT;
  v_caller_name TEXT;
  v_caller_trigram TEXT;
  v_depot RECORD;
  v_item JSONB;
  v_uid TEXT;
  v_can_send BOOLEAN;
  v_can_receive BOOLEAN;
  v_inserted_count INT := 0;
  v_holders_out JSONB := '[]'::jsonb;
BEGIN
  IF current_user = 'anon' OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'anon' THEN
    RAISE EXCEPTION 'Accès refusé : rôle anonyme interdit sur set_depot_holders.' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT id::text, role_id, name, trigram
  INTO v_caller_id, v_caller_role, v_caller_name, v_caller_trigram
  FROM public.core_users
  WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
  LIMIT 1;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Profil utilisateur introuvable ou compte bloqué.' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.is_super_admin()
    OR v_caller_role IN (0, 1)
    OR public.current_user_has_perm('perm_manage_depots')
  ) THEN
    RAISE EXCEPTION 'Permission refusée : perm_manage_depots (ou rôle Administrateur) requise pour gérer les responsables d''un dépôt.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_depot
  FROM public._tot_resolve_depot_record(p_depot_id);

  IF v_depot.depot_id IS NULL THEN
    RAISE EXCEPTION 'Dépôt introuvable (%).', COALESCE(p_depot_id, 'NULL') USING ERRCODE = 'P0002';
  END IF;

  IF p_holders IS NOT NULL AND jsonb_typeof(p_holders) <> 'array' THEN
    RAISE EXCEPTION 'Le paramètre p_holders doit être un tableau JSON.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.stk_depot_holders
  WHERE depot_id = v_depot.depot_id OR LOWER(TRIM(depot_id)) = LOWER(TRIM(v_depot.depot_name));

  IF p_holders IS NOT NULL AND jsonb_typeof(p_holders) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_holders)
    LOOP
      IF jsonb_typeof(v_item) = 'object' THEN
        v_uid := NULLIF(TRIM(COALESCE(v_item->>'user_id', v_item->>'userId', '')), '');
        v_can_send := COALESCE((v_item->>'can_send')::boolean, (v_item->>'canSend')::boolean, false);
        v_can_receive := COALESCE((v_item->>'can_receive')::boolean, (v_item->>'canReceive')::boolean, false);

        IF v_uid IS NOT NULL AND (v_can_send OR v_can_receive) THEN
          IF NOT EXISTS (
            SELECT 1 FROM public.core_users u
            WHERE u.id::text = v_uid AND COALESCE(u.is_blocked, false) = false
          ) THEN
            RAISE EXCEPTION 'Utilisateur responsable introuvable ou bloqué (ID: %).', v_uid USING ERRCODE = '22023';
          END IF;

          INSERT INTO public.stk_depot_holders (depot_id, user_id, can_send, can_receive, updated_at)
          VALUES (v_depot.depot_id, v_uid, v_can_send, v_can_receive, now())
          ON CONFLICT (depot_id, user_id) DO UPDATE
          SET can_send = EXCLUDED.can_send,
              can_receive = EXCLUDED.can_receive,
              updated_at = now();

          v_inserted_count := v_inserted_count + 1;
        END IF;
      END IF;
    END LOOP;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'depot_id', h.depot_id,
        'user_id', h.user_id,
        'user_name', COALESCE(u.name, h.user_id),
        'user_trigram', u.trigram,
        'can_send', h.can_send,
        'can_receive', h.can_receive
      )
      ORDER BY COALESCE(u.name, h.user_id)
    ),
    '[]'::jsonb
  )
  INTO v_holders_out
  FROM public.stk_depot_holders h
  LEFT JOIN public.core_users u ON u.id::text = h.user_id
  WHERE h.depot_id = v_depot.depot_id;

  INSERT INTO public.core_audit_logs (
    id, app, type, action, category, severity,
    user_id, user_name, user_trigram,
    depot_name, table_name, record_id,
    title, description, meta, created_at
  ) VALUES (
    'AUD-HLD-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' || substr(md5(random()::text), 1, 6),
    'stock',
    'DEPOT_HOLDERS_UPDATED',
    'DEPOT_HOLDERS_UPDATED',
    'DEPOTS',
    'INFO',
    v_caller_id,
    v_caller_name,
    v_caller_trigram,
    v_depot.depot_name,
    'stk_depot_holders',
    v_depot.depot_id,
    format('Responsables du dépôt mis à jour : %s', v_depot.depot_name),
    format('%s responsable(s) configuré(s) sur %s par %s', v_inserted_count, v_depot.depot_name, v_caller_name),
    jsonb_build_object(
      'depot_id', v_depot.depot_id,
      'depot_name', v_depot.depot_name,
      'holders_count', v_inserted_count,
      'holders', v_holders_out
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'depot_id', v_depot.depot_id,
    'depot_name', v_depot.depot_name,
    'holders_count', v_inserted_count,
    'holders', v_holders_out
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_depot_holders(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_depot_holders(TEXT, JSONB) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 3. TABLE public.stk_transfers (WORKFLOW COMPLET DE TRANSFERT)
-- -------------------------------------------------------------------------
-- Garde-fou (base ayant reçu une ancienne version de ce script, reconnaissable à la colonne has_variance) : l'ancienne
-- table stk_transfers, d'une AUTRE structure, est mise de côté sans perte : renommée en stk_transfers_old_<horodatage> si elle contient des
-- lignes, supprimée sinon. La table conforme est ensuite créée ci-dessous.
DO $$
DECLARE v_rows bigint; v_old text;
BEGIN
  IF to_regclass('public.stk_transfers') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'stk_transfers' AND column_name = 'has_variance') THEN
    EXECUTE 'SELECT count(*) FROM public.stk_transfers' INTO v_rows;
    IF v_rows = 0 THEN
      DROP TABLE public.stk_transfers CASCADE;
    ELSE
      v_old := 'stk_transfers_old_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');
      EXECUTE format('ALTER TABLE public.stk_transfers RENAME TO %I', v_old);
      -- table d'archive : inaccessible aux clients (RLS + règle de refus), lisible seulement via service_role / SQL Editor
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_old);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_old);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'deny_clients_' || v_old, v_old);
      EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', 'deny_clients_' || v_old, v_old);
      RAISE NOTICE 'stk_transfers (ancienne structure, % lignes) conservée sous un nom stk_transfers_old_*', v_rows;
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.stk_transfers (
  id TEXT PRIMARY KEY DEFAULT ('TRF-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS') || '-' || UPPER(SUBSTRING(md5(random()::text) FROM 1 FOR 6))),
  transfer_number TEXT NOT NULL UNIQUE,
  batch_id UUID UNIQUE,
  source_depot_id TEXT,
  source_depot TEXT NOT NULL,
  dest_depot_id TEXT,
  dest_depot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'IN_TRANSIT',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason TEXT,
  total_pieces NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_trigram TEXT,
  receiver_id TEXT,
  receiver_name TEXT,
  receiver_note TEXT,
  received_at TIMESTAMPTZ,
  sender_confirmed_by TEXT,
  sender_confirmed_by_name TEXT,
  sender_confirmed_at TIMESTAMPTZ,
  sender_comment TEXT,
  resolved_by TEXT,
  resolved_by_name TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_action TEXT,
  resolution_note TEXT,
  comments_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stk_transfers_status_chk CHECK (
    status IN (
      'IN_TRANSIT',
      'AWAITING_SENDER',
      'DISPUTED',
      'RECEIVED',
      'PARTIALLY_RECEIVED',
      'REJECTED',
      'CANCELLED'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_stk_transfers_status ON public.stk_transfers(status);
CREATE INDEX IF NOT EXISTS idx_stk_transfers_source_depot ON public.stk_transfers(source_depot);
CREATE INDEX IF NOT EXISTS idx_stk_transfers_dest_depot ON public.stk_transfers(dest_depot);
CREATE INDEX IF NOT EXISTS idx_stk_transfers_sender_id ON public.stk_transfers(sender_id);
CREATE INDEX IF NOT EXISTS idx_stk_transfers_created_at ON public.stk_transfers(created_at DESC);

ALTER TABLE public.stk_transfers ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stk_transfers'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.stk_transfers', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "stk_transfers_select_authenticated"
  ON public.stk_transfers
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON TABLE public.stk_transfers FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.stk_transfers FROM authenticated;
GRANT SELECT ON TABLE public.stk_transfers TO authenticated;
GRANT ALL ON TABLE public.stk_transfers TO service_role;

-- -------------------------------------------------------------------------
-- 4. HELPERS D'AUTORISATION SUR LES DÉPÔTS (ENVOI & RÉCEPTION)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tot_can_send_from_depot(
  p_user_id TEXT,
  p_role_id INT,
  p_depot_id TEXT,
  p_depot_name TEXT,
  p_depot_type TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_super_admin() OR p_role_id IN (0, 1) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.stk_depot_holders h
    WHERE (h.depot_id = p_depot_id OR LOWER(TRIM(h.depot_id)) = LOWER(TRIM(p_depot_name)))
      AND h.user_id = p_user_id
      AND h.can_send = true
  ) THEN
    RETURN true;
  END IF;

  IF UPPER(COALESCE(p_depot_type, 'FIXED')) = 'FIXED'
     AND public.current_user_has_perm('perm_stock_transfer_store') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public._tot_can_send_from_depot(TEXT, INT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._tot_can_send_from_depot(TEXT, INT, TEXT, TEXT, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._tot_can_receive_at_depot(
  p_user_id TEXT,
  p_role_id INT,
  p_depot_id TEXT,
  p_depot_name TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_super_admin()
     OR p_role_id IN (0, 1)
     OR public.current_user_has_perm('perm_stock_receive_all') THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.stk_depot_holders h
    WHERE (h.depot_id = p_depot_id OR LOWER(TRIM(h.depot_id)) = LOWER(TRIM(p_depot_name)))
      AND h.user_id = p_user_id
      AND h.can_receive = true
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public._tot_can_receive_at_depot(TEXT, INT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._tot_can_receive_at_depot(TEXT, INT, TEXT, TEXT) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 5. RPC public.send_stock_transfer (ENVOI EN TRANSIT)
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.send_stock_transfer(UUID, TEXT, TEXT, JSONB, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.send_stock_transfer(
  p_batch_id UUID,
  p_source_depot TEXT,
  p_dest_depot TEXT,
  p_items JSONB,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_role INT;
  v_caller_name TEXT;
  v_caller_trigram TEXT;
  v_caller_dept TEXT;
  v_is_blocked BOOLEAN;
  v_existing_op RECORD;

  v_src RECORD;
  v_dst RECORD;
  v_receiver_names TEXT[];
  v_clean_reason TEXT;
  v_item_count INT;
  v_idx INT;
  v_item JSONB;

  v_product_id TEXT;
  v_qty NUMERIC;
  v_dest_rack TEXT;
  v_product_ref TEXT;
  v_product_brand TEXT;
  v_product_model TEXT;
  v_unit_price NUMERIC;
  v_prod_initial_qty NUMERIC;
  v_prod_store_name TEXT;

  v_current_source_stock NUMERIC;
  v_new_source_stock NUMERIC;
  v_total_product_stock NUMERIC;
  v_line_cost NUMERIC;
  v_total_batch_cost NUMERIC := 0;
  v_total_pieces NUMERIC := 0;

  v_transfer_id TEXT;
  v_transfer_number TEXT;
  v_mov_id TEXT;
  v_transfer_items JSONB := '[]'::jsonb;
  v_comments JSONB := '[]'::jsonb;
  v_result JSONB;
BEGIN
  IF current_user = 'anon' OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'anon' THEN
    RAISE EXCEPTION 'Permission denied: anonymous access is forbidden for send_stock_transfer' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required: user is not signed in' USING ERRCODE = '42501';
  END IF;

  SELECT id::text, role_id, name, trigram, department, is_blocked
  INTO v_caller_id, v_caller_role, v_caller_name, v_caller_trigram, v_caller_dept, v_is_blocked
  FROM public.core_users
  WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
  LIMIT 1;

  IF v_caller_id IS NULL OR v_is_blocked = TRUE THEN
    RAISE EXCEPTION 'User profile not found or blocked' USING ERRCODE = '42501';
  END IF;

  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'Batch ID (p_batch_id) is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing_op
  FROM public.core_processed_operations
  WHERE operation_id = p_batch_id
  LIMIT 1;

  IF v_existing_op.operation_id IS NOT NULL THEN
    IF v_existing_op.user_id IS DISTINCT FROM v_caller_id THEN
      RAISE EXCEPTION 'Batch ID already registered by another user' USING ERRCODE = '42501';
    END IF;
    RETURN v_existing_op.result || jsonb_build_object('idempotent_replay', true);
  END IF;

  SELECT * INTO v_src FROM public._tot_resolve_depot_record(p_source_depot);
  SELECT * INTO v_dst FROM public._tot_resolve_depot_record(p_dest_depot);

  IF v_src.depot_id IS NULL OR v_dst.depot_id IS NULL THEN
    RAISE EXCEPTION 'Dépôt source ("%") ou dépôt destination ("%") introuvable.',
      COALESCE(p_source_depot, ''), COALESCE(p_dest_depot, '')
      USING ERRCODE = '22023';
  END IF;

  IF v_src.depot_id = v_dst.depot_id OR LOWER(v_src.depot_name) = LOWER(v_dst.depot_name) THEN
    RAISE EXCEPTION 'Le dépôt de destination ("%") doit être distinct du dépôt source ("%").',
      v_dst.depot_name, v_src.depot_name
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_src.is_active OR NOT v_dst.is_active THEN
    RAISE EXCEPTION 'Transfert refusé : le dépôt source ou le dépôt de destination est fermé ou inactif.'
      USING ERRCODE = '22023';
  END IF;

  -- Vérification des droits d'envoi sur le dépôt source
  IF NOT public._tot_can_send_from_depot(
    v_caller_id,
    v_caller_role,
    v_src.depot_id,
    v_src.depot_name,
    v_src.depot_type
  ) THEN
    RAISE EXCEPTION 'Accès refusé : vous n''êtes pas responsable « envoi » du dépôt "%" (ni détenteur de perm_stock_transfer_store pour un dépôt magasin).',
      v_src.depot_name
      USING ERRCODE = '42501';
  END IF;

  -- Vérification que le dépôt destination a au moins un responsable réception actif
  SELECT ARRAY_AGG(COALESCE(u.name, h.user_id) ORDER BY COALESCE(u.name, h.user_id))
  INTO v_receiver_names
  FROM public.stk_depot_holders h
  JOIN public.core_users u ON u.id::text = h.user_id AND COALESCE(u.is_blocked, false) = false
  WHERE (h.depot_id = v_dst.depot_id OR LOWER(TRIM(h.depot_id)) = LOWER(TRIM(v_dst.depot_name)))
    AND h.can_receive = true;

  IF v_receiver_names IS NULL OR array_length(v_receiver_names, 1) IS NULL THEN
    RAISE EXCEPTION 'Transfert refusé : le dépôt de destination "%" n''a aucun responsable de réception actif désigné.',
      v_dst.depot_name
      USING ERRCODE = '22023';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items doit être un tableau JSON non vide.' USING ERRCODE = '22023';
  END IF;

  v_item_count := jsonb_array_length(p_items);
  IF v_item_count < 1 OR v_item_count > 200 THEN
    RAISE EXCEPTION 'Le lot de transfert doit contenir entre 1 et 200 articles (reçu : %).', v_item_count
      USING ERRCODE = '22023';
  END IF;

  v_clean_reason := COALESCE(
    NULLIF(TRIM(COALESCE(p_reason, '')), ''),
    format('Transfert %s -> %s', v_src.depot_name, v_dst.depot_name)
  );

  v_transfer_number := 'TRF-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' || UPPER(SUBSTRING(replace(p_batch_id::text, '-', '') FROM 1 FOR 6));
  v_transfer_id := v_transfer_number;

  PERFORM set_config('app.stock_rpc', 'on', true);

  FOR v_idx IN 0 .. (v_item_count - 1) LOOP
    v_item := p_items -> v_idx;
    IF v_item IS NULL OR jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Ligne % invalide dans p_items.', v_idx + 1 USING ERRCODE = '22023';
    END IF;

    v_product_id := NULLIF(TRIM(COALESCE(v_item->>'product_id', '')), '');
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'product_id manquant à la ligne %.', v_idx + 1 USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_qty := (v_item->>'quantity')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_qty := NULL;
    END;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantité invalide (%) pour l''article "%" (ligne %) : la quantité doit être strictement supérieure à 0.',
        COALESCE(v_item->>'quantity', 'NULL'), v_product_id, v_idx + 1
        USING ERRCODE = '22023';
    END IF;

    v_dest_rack := NULLIF(TRIM(COALESCE(v_item->>'dest_rack', '')), '');

    SELECT
      reference,
      COALESCE(brand, ''),
      COALESCE(model, ''),
      COALESCE(unit_price, 0),
      COALESCE(quantity, 0),
      COALESCE(NULLIF(TRIM(store_name), ''), 'Dépôt Principal')
    INTO
      v_product_ref,
      v_product_brand,
      v_product_model,
      v_unit_price,
      v_prod_initial_qty,
      v_prod_store_name
    FROM public.stk_products
    WHERE id::text = v_product_id
    FOR UPDATE;

    IF v_product_ref IS NULL THEN
      RAISE EXCEPTION 'Article introuvable (ID: %).', v_product_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.stk_stock_levels WHERE product_id = v_product_id) THEN
      INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, updated_at)
      VALUES (v_product_id, v_prod_store_name, v_prod_initial_qty, now())
      ON CONFLICT (product_id, depot_name) DO NOTHING;
    END IF;

    INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, updated_at)
    VALUES (v_product_id, v_src.depot_name, 0, now())
    ON CONFLICT (product_id, depot_name) DO NOTHING;

    SELECT quantity
    INTO v_current_source_stock
    FROM public.stk_stock_levels
    WHERE product_id = v_product_id AND depot_name = v_src.depot_name
    FOR UPDATE;

    IF v_current_source_stock < v_qty THEN
      RAISE EXCEPTION 'Stock insuffisant dans le dépôt "%" pour "%" (Disponible: %, Demandé: %).',
        v_src.depot_name, COALESCE(v_product_ref, v_product_id), v_current_source_stock, v_qty
        USING ERRCODE = '23514';
    END IF;

    v_new_source_stock := v_current_source_stock - v_qty;

    UPDATE public.stk_stock_levels
    SET quantity = v_new_source_stock,
        updated_at = now()
    WHERE product_id = v_product_id AND depot_name = v_src.depot_name;

    -- Le stock quitte le dépôt source et reste EN TRANSIT jusqu'à la validation par le dépôt receveur
    SELECT COALESCE(SUM(quantity), 0)
    INTO v_total_product_stock
    FROM public.stk_stock_levels
    WHERE product_id = v_product_id;

    UPDATE public.stk_products
    SET quantity = v_total_product_stock,
        updated_at = now()
    WHERE id::text = v_product_id;

    v_mov_id := 'MOV-TRF-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS') || '-' || p_batch_id::text || '-' || (v_idx + 1)::text;
    v_line_cost := ROUND(v_qty * COALESCE(v_unit_price, 0), 2);
    v_total_batch_cost := v_total_batch_cost + v_line_cost;
    v_total_pieces := v_total_pieces + v_qty;

    INSERT INTO public.stk_movements (
      id, product_id, product_ref, user_id, user_name, movement_type,
      quantity_changed, reason, site_number, department_name, total_cost,
      depot_name, dest_depot_name, created_at
    ) VALUES (
      v_mov_id,
      v_product_id,
      v_product_ref,
      v_caller_id,
      v_caller_name,
      'OUT',
      v_qty,
      v_clean_reason,
      format('TRANSFERT -> %s', v_dst.depot_name),
      COALESCE(v_caller_dept, 'Logistique'),
      v_line_cost,
      v_src.depot_name,
      v_dst.depot_name,
      now()
    );

    v_transfer_items := v_transfer_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product_id,
        'product_ref', v_product_ref,
        'product_name', TRIM(v_product_brand || ' ' || v_product_model),
        'unit_price', v_unit_price,
        'quantity', v_qty,
        'quantity_sent', v_qty,
        'quantity_received', NULL,
        'quantity_pending', 0,
        'dest_rack', v_dest_rack,
        'line_status', 'IN_TRANSIT',
        'accepted', NULL,
        'receiver_reason', NULL,
        'movement_id', v_mov_id
      )
    );
  END LOOP;

  IF p_reason IS NOT NULL AND TRIM(p_reason) <> '' THEN
    v_comments := jsonb_build_array(
      jsonb_build_object(
        'at', now(),
        'role', 'SENDER',
        'user_id', v_caller_id,
        'user_name', v_caller_name,
        'action', 'SENT',
        'comment', TRIM(p_reason)
      )
    );
  END IF;

  INSERT INTO public.stk_transfers (
    id, transfer_number, batch_id,
    source_depot_id, source_depot,
    dest_depot_id, dest_depot,
    status, items, reason,
    total_pieces, total_cost,
    sender_id, sender_name, sender_trigram,
    comments_history, created_at, updated_at
  ) VALUES (
    v_transfer_id, v_transfer_number, p_batch_id,
    v_src.depot_id, v_src.depot_name,
    v_dst.depot_id, v_dst.depot_name,
    'IN_TRANSIT', v_transfer_items, v_clean_reason,
    v_total_pieces, v_total_batch_cost,
    v_caller_id, v_caller_name, v_caller_trigram,
    v_comments, now(), now()
  );

  INSERT INTO public.core_audit_logs (
    id, app, type, action, category, severity,
    user_id, user_name, user_trigram,
    quantity_changed, site_number, depot_name, table_name, record_id,
    title, description, badge_text, meta, created_at
  ) VALUES (
    'AUD-TRF-SENT-' || p_batch_id::text,
    'stock',
    'STOCK_TRANSFER_SENT',
    'STOCK_TRANSFER_SENT',
    'MOVEMENTS',
    'INFO',
    v_caller_id,
    v_caller_name,
    v_caller_trigram,
    v_total_pieces,
    format('TRANSFERT -> %s', v_dst.depot_name),
    v_src.depot_name,
    'stk_transfers',
    v_transfer_id,
    format('Transfert expédié %s (%s art., %s pce(s))', v_transfer_number, v_item_count, v_total_pieces),
    format('Transfert %s envoyé par %s : %s → %s (%s) — en attente de réception par %s',
      v_transfer_number, v_caller_name, v_src.depot_name, v_dst.depot_name, v_clean_reason, array_to_string(v_receiver_names, ', ')),
    format('%s → %s', v_src.depot_name, v_dst.depot_name),
    jsonb_build_object(
      'transfer_id', v_transfer_id,
      'transfer_number', v_transfer_number,
      'batch_id', p_batch_id,
      'status', 'IN_TRANSIT',
      'source_depot', v_src.depot_name,
      'dest_depot', v_dst.depot_name,
      'receiver_holders', to_jsonb(v_receiver_names),
      'item_count', v_item_count,
      'total_pieces', v_total_pieces,
      'total_cost', v_total_batch_cost,
      'reason', v_clean_reason,
      'items', v_transfer_items
    ),
    now()
  );

  v_result := jsonb_build_object(
    'success', true,
    'transfer_id', v_transfer_id,
    'transfer_number', v_transfer_number,
    'status', 'IN_TRANSIT',
    'batch_id', p_batch_id,
    'source_depot', v_src.depot_name,
    'dest_depot', v_dst.depot_name,
    'receiver_holders', to_jsonb(v_receiver_names),
    'reason', v_clean_reason,
    'item_count', v_item_count,
    'total_pieces', v_total_pieces,
    'total_cost', v_total_batch_cost,
    'items', v_transfer_items,
    'timestamp', now()
  );

  INSERT INTO public.core_processed_operations (
    operation_id, app, user_id, entity, action, action_type, result, created_at
  ) VALUES (
    p_batch_id, 'stock', v_caller_id, 'stk_transfers', 'SEND_STOCK_TRANSFER', 'STOCK_TRANSFER_BATCH', v_result, now()
  )
  ON CONFLICT (operation_id) DO NOTHING;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.send_stock_transfer(UUID, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_stock_transfer(UUID, TEXT, TEXT, JSONB, TEXT) TO authenticated, service_role;

-- Redirection de l'ancien appel transfer_stock_batch vers send_stock_transfer (aucun contournement possible)
CREATE OR REPLACE FUNCTION public.transfer_stock_batch(
  p_batch_id UUID,
  p_source_depot TEXT,
  p_dest_depot TEXT,
  p_items JSONB,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.send_stock_transfer(p_batch_id, p_source_depot, p_dest_depot, p_items, p_reason);
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_stock_batch(UUID, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_stock_batch(UUID, TEXT, TEXT, JSONB, TEXT) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 6. RPC public.receive_stock_transfer (RÉCEPTION ARTICLE PAR ARTICLE)
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.receive_stock_transfer(TEXT, JSONB, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.receive_stock_transfer(
  p_transfer_id TEXT,
  p_items JSONB DEFAULT '[]'::jsonb,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_role INT;
  v_caller_name TEXT;
  v_caller_trigram TEXT;
  v_trf public.stk_transfers%ROWTYPE;

  v_override_map JSONB := '{}'::jsonb;
  v_ov JSONB;
  v_ov_pid TEXT;

  v_line JSONB;
  v_pid TEXT;
  v_pref TEXT;
  v_qty_sent NUMERIC;
  v_dest_rack TEXT;
  v_unit_price NUMERIC;

  v_accepted BOOLEAN;
  v_qty_received NUMERIC;
  v_qty_pending NUMERIC;
  v_reason TEXT;
  v_line_status TEXT;

  v_accepted_count INT := 0;
  v_modified_count INT := 0;
  v_refused_count INT := 0;
  v_total_lines INT := 0;

  v_new_items JSONB := '[]'::jsonb;
  v_new_status TEXT;
  v_audit_type TEXT;
  v_audit_severity TEXT;
  v_total_product_stock NUMERIC;
  v_comments JSONB;
BEGIN
  IF current_user = 'anon' OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'anon' THEN
    RAISE EXCEPTION 'Accès refusé : rôle anonyme interdit.' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT id::text, role_id, name, trigram
  INTO v_caller_id, v_caller_role, v_caller_name, v_caller_trigram
  FROM public.core_users
  WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
  LIMIT 1;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Profil utilisateur introuvable ou compte bloqué.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_trf
  FROM public.stk_transfers
  WHERE id = TRIM(COALESCE(p_transfer_id, ''))
     OR transfer_number = TRIM(COALESCE(p_transfer_id, ''))
  FOR UPDATE;

  IF v_trf.id IS NULL THEN
    RAISE EXCEPTION 'Transfert introuvable (%).', COALESCE(p_transfer_id, 'NULL') USING ERRCODE = 'P0002';
  END IF;

  IF v_trf.status <> 'IN_TRANSIT' THEN
    RAISE EXCEPTION 'Ce transfert (%) n''est plus en transit (statut actuel : %).',
      v_trf.transfer_number, v_trf.status
      USING ERRCODE = '22023';
  END IF;

  IF NOT public._tot_can_receive_at_depot(
    v_caller_id,
    v_caller_role,
    v_trf.dest_depot_id,
    v_trf.dest_depot
  ) THEN
    RAISE EXCEPTION 'Accès refusé : seuls les responsables « réception » du dépôt "%" (ou la logistique) peuvent valider cette réception.',
      v_trf.dest_depot
      USING ERRCODE = '42501';
  END IF;

  -- L'expéditeur ne peut pas valider sa propre réception (sauf admin rôles 0/1)
  IF v_trf.sender_id = v_caller_id AND NOT (public.is_super_admin() OR v_caller_role IN (0, 1)) THEN
    RAISE EXCEPTION 'Séparation des tâches : l''expéditeur ne peut pas valider lui-même la réception de son propre transfert.'
      USING ERRCODE = '42501';
  END IF;

  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
    FOR v_ov IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
      IF jsonb_typeof(v_ov) = 'object' THEN
        v_ov_pid := NULLIF(TRIM(COALESCE(v_ov->>'product_id', v_ov->>'productId', '')), '');
        IF v_ov_pid IS NOT NULL THEN
          v_override_map := v_override_map || jsonb_build_object(v_ov_pid, v_ov);
        END IF;
      END IF;
    END LOOP;
  END IF;

  PERFORM set_config('app.stock_rpc', 'on', true);

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_trf.items)
  LOOP
    v_total_lines := v_total_lines + 1;
    v_pid := v_line->>'product_id';
    v_pref := COALESCE(v_line->>'product_ref', v_pid);
    v_qty_sent := COALESCE((v_line->>'quantity_sent')::numeric, (v_line->>'quantity')::numeric, 0);
    v_dest_rack := NULLIF(TRIM(COALESCE(v_line->>'dest_rack', '')), '');
    v_unit_price := COALESCE((v_line->>'unit_price')::numeric, 0);

    IF v_override_map ? v_pid THEN
      v_ov := v_override_map -> v_pid;
      v_accepted := COALESCE((v_ov->>'accepted')::boolean, true);
      v_reason := NULLIF(TRIM(COALESCE(v_ov->>'reason', '')), '');
      IF v_accepted = false THEN
        v_qty_received := 0;
      ELSIF v_ov ? 'quantity_received' AND v_ov->>'quantity_received' IS NOT NULL THEN
        v_qty_received := (v_ov->>'quantity_received')::numeric;
      ELSE
        v_qty_received := v_qty_sent;
      END IF;
    ELSE
      v_accepted := true;
      v_qty_received := v_qty_sent;
      v_reason := NULL;
    END IF;

    IF v_accepted = false THEN
      -- Article refusé : motif obligatoire, retour immédiat au dépôt source
      IF v_reason IS NULL THEN
        RAISE EXCEPTION 'Un motif est obligatoire pour refuser l''article "%".', v_pref
          USING ERRCODE = '22023';
      END IF;

      v_qty_received := 0;
      v_qty_pending := 0;
      v_line_status := 'REFUSED';
      v_refused_count := v_refused_count + 1;

      INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, updated_at)
      VALUES (v_pid, v_trf.source_depot, v_qty_sent, now())
      ON CONFLICT (product_id, depot_name) DO UPDATE
      SET quantity = public.stk_stock_levels.quantity + EXCLUDED.quantity,
          updated_at = now();

      SELECT COALESCE(SUM(quantity), 0) INTO v_total_product_stock
      FROM public.stk_stock_levels WHERE product_id = v_pid;

      UPDATE public.stk_products
      SET quantity = v_total_product_stock, updated_at = now()
      WHERE id::text = v_pid;

      INSERT INTO public.stk_movements (
        id, product_id, product_ref, user_id, user_name, movement_type,
        quantity_changed, reason, site_number, department_name, total_cost,
        depot_name, dest_depot_name, created_at
      ) VALUES (
        'MOV-TRF-REF-' || v_trf.id || '-' || v_total_lines::text,
        v_pid, v_pref, v_caller_id, v_caller_name, 'IN',
        v_qty_sent,
        format('[REFUS TRANSFERT %s] %s', v_trf.transfer_number, v_reason),
        format('RETOUR <- %s', v_trf.dest_depot),
        'Logistique',
        ROUND(v_qty_sent * v_unit_price, 2),
        v_trf.source_depot,
        v_trf.source_depot,
        now()
      );

      INSERT INTO public.core_audit_logs (
        id, app, type, action, category, severity,
        user_id, user_name, user_trigram,
        product_id, product_ref, quantity_changed, depot_name, table_name, record_id,
        title, description, meta, created_at
      ) VALUES (
        'AUD-TRF-LREF-' || v_trf.id || '-' || v_total_lines::text || '-' || substr(md5(random()::text), 1, 4),
        'stock',
        'STOCK_TRANSFER_LINE_REFUSED',
        'STOCK_TRANSFER_LINE_REFUSED',
        'MOVEMENTS',
        'WARNING',
        v_caller_id, v_caller_name, v_caller_trigram,
        v_pid, v_pref, v_qty_sent, v_trf.dest_depot, 'stk_transfers', v_trf.id,
        format('Article refusé à la réception (%s : %s pce(s))', v_pref, v_qty_sent),
        format('Refus de %s (%s pce(s)) sur %s par %s — Motif : %s (retourné à %s)',
          v_pref, v_qty_sent, v_trf.transfer_number, v_caller_name, v_reason, v_trf.source_depot),
        jsonb_build_object(
          'transfer_id', v_trf.id,
          'transfer_number', v_trf.transfer_number,
          'product_id', v_pid,
          'product_ref', v_pref,
          'quantity_sent', v_qty_sent,
          'quantity_received', 0,
          'reason', v_reason,
          'source_depot', v_trf.source_depot,
          'dest_depot', v_trf.dest_depot
        ),
        now()
      );

    ELSIF v_qty_received < v_qty_sent THEN
      -- Quantité modifiée à la baisse : entre 1 et v_qty_sent - 1 + commentaire obligatoire
      IF v_qty_received < 1 THEN
        RAISE EXCEPTION 'La quantité reçue pour "%" doit être comprise entre 1 et % (pour 0, utilisez « Refuser »).',
          v_pref, v_qty_sent
          USING ERRCODE = '22023';
      END IF;

      IF v_reason IS NULL THEN
        RAISE EXCEPTION 'Un commentaire est obligatoire lorsque la quantité reçue est modifiée pour l''article "%".',
          v_pref
          USING ERRCODE = '22023';
      END IF;

      v_qty_pending := v_qty_sent - v_qty_received;
      v_line_status := 'MODIFIED_AWAITING_SENDER';
      v_modified_count := v_modified_count + 1;

      INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, rack_location, updated_at)
      VALUES (v_pid, v_trf.dest_depot, v_qty_received, v_dest_rack, now())
      ON CONFLICT (product_id, depot_name) DO UPDATE
      SET quantity = public.stk_stock_levels.quantity + EXCLUDED.quantity,
          rack_location = COALESCE(EXCLUDED.rack_location, public.stk_stock_levels.rack_location),
          updated_at = now();

      SELECT COALESCE(SUM(quantity), 0) INTO v_total_product_stock
      FROM public.stk_stock_levels WHERE product_id = v_pid;

      UPDATE public.stk_products
      SET quantity = v_total_product_stock, updated_at = now()
      WHERE id::text = v_pid;

      INSERT INTO public.core_audit_logs (
        id, app, type, action, category, severity,
        user_id, user_name, user_trigram,
        product_id, product_ref, quantity_changed, depot_name, table_name, record_id,
        title, description, meta, created_at
      ) VALUES (
        'AUD-TRF-LMOD-' || v_trf.id || '-' || v_total_lines::text || '-' || substr(md5(random()::text), 1, 4),
        'stock',
        'STOCK_TRANSFER_LINE_MODIFIED',
        'STOCK_TRANSFER_LINE_MODIFIED',
        'MOVEMENTS',
        'WARNING',
        v_caller_id, v_caller_name, v_caller_trigram,
        v_pid, v_pref, v_qty_received, v_trf.dest_depot, 'stk_transfers', v_trf.id,
        format('Quantité modifiée à la réception (%s : %s/%s)', v_pref, v_qty_received, v_qty_sent),
        format('Réception partielle de %s sur %s par %s : reçu %s sur %s (%s en attente de confirmation expéditeur) — Commentaire : %s',
          v_pref, v_trf.transfer_number, v_caller_name, v_qty_received, v_qty_sent, v_qty_pending, v_reason),
        jsonb_build_object(
          'transfer_id', v_trf.id,
          'transfer_number', v_trf.transfer_number,
          'product_id', v_pid,
          'product_ref', v_pref,
          'quantity_sent', v_qty_sent,
          'quantity_received', v_qty_received,
          'quantity_pending', v_qty_pending,
          'reason', v_reason,
          'source_depot', v_trf.source_depot,
          'dest_depot', v_trf.dest_depot
        ),
        now()
      );

    ELSIF v_qty_received > v_qty_sent THEN
      RAISE EXCEPTION 'Surplus interdit pour "%" (envoyé : %, saisi : %). Créez un nouveau transfert pour tout surplus.',
        v_pref, v_qty_sent, v_qty_received
        USING ERRCODE = '22023';

    ELSE
      -- Accepté intégralement
      v_qty_received := v_qty_sent;
      v_qty_pending := 0;
      v_line_status := 'ACCEPTED';
      v_accepted_count := v_accepted_count + 1;

      INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, rack_location, updated_at)
      VALUES (v_pid, v_trf.dest_depot, v_qty_sent, v_dest_rack, now())
      ON CONFLICT (product_id, depot_name) DO UPDATE
      SET quantity = public.stk_stock_levels.quantity + EXCLUDED.quantity,
          rack_location = COALESCE(EXCLUDED.rack_location, public.stk_stock_levels.rack_location),
          updated_at = now();

      SELECT COALESCE(SUM(quantity), 0) INTO v_total_product_stock
      FROM public.stk_stock_levels WHERE product_id = v_pid;

      UPDATE public.stk_products
      SET quantity = v_total_product_stock,
          store_name = CASE
            WHEN COALESCE((SELECT quantity FROM public.stk_stock_levels WHERE product_id = v_pid AND depot_name = v_trf.source_depot), 0) = 0
            THEN v_trf.dest_depot
            ELSE store_name
          END,
          updated_at = now()
      WHERE id::text = v_pid;
    END IF;

    v_new_items := v_new_items || jsonb_build_array(
      v_line || jsonb_build_object(
        'accepted', v_accepted,
        'quantity_received', v_qty_received,
        'quantity_pending', v_qty_pending,
        'receiver_reason', v_reason,
        'line_status', v_line_status
      )
    );
  END LOOP;

  IF v_modified_count > 0 THEN
    v_new_status := 'AWAITING_SENDER';
    v_audit_type := 'STOCK_TRANSFER_AWAITING_SENDER';
    v_audit_severity := 'WARNING';
  ELSIF v_refused_count = v_total_lines THEN
    v_new_status := 'REJECTED';
    v_audit_type := 'STOCK_TRANSFER_REJECTED';
    v_audit_severity := 'WARNING';
  ELSIF v_refused_count > 0 THEN
    v_new_status := 'PARTIALLY_RECEIVED';
    v_audit_type := 'STOCK_TRANSFER_PARTIALLY_RECEIVED';
    v_audit_severity := 'WARNING';
  ELSE
    v_new_status := 'RECEIVED';
    v_audit_type := 'STOCK_TRANSFER_RECEIVED';
    v_audit_severity := 'INFO';
  END IF;

  v_comments := COALESCE(v_trf.comments_history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'at', now(),
      'role', 'RECEIVER',
      'user_id', v_caller_id,
      'user_name', v_caller_name,
      'action', v_new_status,
      'comment', COALESCE(NULLIF(TRIM(p_note), ''), format('Validation réception (%s accepté(s), %s modifié(s), %s refusé(s))', v_accepted_count, v_modified_count, v_refused_count))
    )
  );

  UPDATE public.stk_transfers
  SET status = v_new_status,
      items = v_new_items,
      receiver_id = v_caller_id,
      receiver_name = v_caller_name,
      receiver_note = NULLIF(TRIM(p_note), ''),
      received_at = now(),
      comments_history = v_comments,
      updated_at = now()
  WHERE id = v_trf.id;

  INSERT INTO public.core_audit_logs (
    id, app, type, action, category, severity,
    user_id, user_name, user_trigram,
    depot_name, table_name, record_id,
    title, description, meta, created_at
  ) VALUES (
    'AUD-TRF-RCV-' || v_trf.id || '-' || substr(md5(random()::text), 1, 6),
    'stock',
    v_audit_type,
    v_audit_type,
    'MOVEMENTS',
    v_audit_severity,
    v_caller_id, v_caller_name, v_caller_trigram,
    v_trf.dest_depot, 'stk_transfers', v_trf.id,
    format('Réception transfert %s → %s', v_trf.transfer_number, v_new_status),
    format('Validation du transfert %s par %s (%s accepté(s), %s modifié(s), %s refusé(s))',
      v_trf.transfer_number, v_caller_name, v_accepted_count, v_modified_count, v_refused_count),
    jsonb_build_object(
      'transfer_id', v_trf.id,
      'transfer_number', v_trf.transfer_number,
      'status', v_new_status,
      'source_depot', v_trf.source_depot,
      'dest_depot', v_trf.dest_depot,
      'accepted_count', v_accepted_count,
      'modified_count', v_modified_count,
      'refused_count', v_refused_count,
      'receiver_note', NULLIF(TRIM(p_note), ''),
      'items', v_new_items
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_trf.id,
    'transfer_number', v_trf.transfer_number,
    'status', v_new_status,
    'accepted_count', v_accepted_count,
    'modified_count', v_modified_count,
    'refused_count', v_refused_count,
    'items', v_new_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.receive_stock_transfer(TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_stock_transfer(TEXT, JSONB, TEXT) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 7. RPC public.reject_stock_transfer (REFUS EN BLOC, MOTIF OBLIGATOIRE)
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.reject_stock_transfer(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.reject_stock_transfer(
  p_transfer_id TEXT,
  p_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_note TEXT := NULLIF(TRIM(COALESCE(p_note, '')), '');
  v_trf public.stk_transfers%ROWTYPE;
  v_reject_items JSONB := '[]'::jsonb;
  v_line JSONB;
BEGIN
  IF v_clean_note IS NULL THEN
    RAISE EXCEPTION 'Un motif est obligatoire pour refuser un transfert en bloc.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_trf
  FROM public.stk_transfers
  WHERE id = TRIM(COALESCE(p_transfer_id, ''))
     OR transfer_number = TRIM(COALESCE(p_transfer_id, ''));

  IF v_trf.id IS NULL THEN
    RAISE EXCEPTION 'Transfert introuvable (%).', COALESCE(p_transfer_id, 'NULL') USING ERRCODE = 'P0002';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_trf.items)
  LOOP
    v_reject_items := v_reject_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_line->>'product_id',
        'accepted', false,
        'quantity_received', 0,
        'reason', v_clean_note
      )
    );
  END LOOP;

  RETURN public.receive_stock_transfer(v_trf.id, v_reject_items, v_clean_note);
END;
$$;

REVOKE ALL ON FUNCTION public.reject_stock_transfer(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_stock_transfer(TEXT, TEXT) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 8. RPC public.cancel_stock_transfer (ANNULATION PAR EXPÉDITEUR OU ADMIN)
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cancel_stock_transfer(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.cancel_stock_transfer(
  p_transfer_id TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_role INT;
  v_caller_name TEXT;
  v_caller_trigram TEXT;
  v_trf public.stk_transfers%ROWTYPE;
  v_line JSONB;
  v_pid TEXT;
  v_qty_sent NUMERIC;
  v_total_product_stock NUMERIC;
  v_new_items JSONB := '[]'::jsonb;
  v_comments JSONB;
BEGIN
  IF current_user = 'anon' OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'anon' THEN
    RAISE EXCEPTION 'Accès refusé : rôle anonyme interdit.' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT id::text, role_id, name, trigram
  INTO v_caller_id, v_caller_role, v_caller_name, v_caller_trigram
  FROM public.core_users
  WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
  LIMIT 1;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Profil utilisateur introuvable ou compte bloqué.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_trf
  FROM public.stk_transfers
  WHERE id = TRIM(COALESCE(p_transfer_id, ''))
     OR transfer_number = TRIM(COALESCE(p_transfer_id, ''))
  FOR UPDATE;

  IF v_trf.id IS NULL THEN
    RAISE EXCEPTION 'Transfert introuvable (%).', COALESCE(p_transfer_id, 'NULL') USING ERRCODE = 'P0002';
  END IF;

  IF v_trf.status <> 'IN_TRANSIT' THEN
    RAISE EXCEPTION 'Seul un transfert en transit (IN_TRANSIT) peut être annulé (statut actuel : %).', v_trf.status
      USING ERRCODE = '22023';
  END IF;

  IF NOT (
    v_trf.sender_id = v_caller_id
    OR public.is_super_admin()
    OR v_caller_role IN (0, 1)
    OR EXISTS (
      SELECT 1 FROM public.stk_depot_holders h
      WHERE (h.depot_id = v_trf.source_depot_id OR LOWER(TRIM(h.depot_id)) = LOWER(TRIM(v_trf.source_depot)))
        AND h.user_id = v_caller_id
        AND h.can_send = true
    )
  ) THEN
    RAISE EXCEPTION 'Accès refusé : seul l''expéditeur, un responsable envoi du dépôt source ou un administrateur peut annuler ce transfert.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.stock_rpc', 'on', true);

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_trf.items)
  LOOP
    v_pid := v_line->>'product_id';
    v_qty_sent := COALESCE((v_line->>'quantity_sent')::numeric, (v_line->>'quantity')::numeric, 0);

    INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, updated_at)
    VALUES (v_pid, v_trf.source_depot, v_qty_sent, now())
    ON CONFLICT (product_id, depot_name) DO UPDATE
    SET quantity = public.stk_stock_levels.quantity + EXCLUDED.quantity,
        updated_at = now();

    SELECT COALESCE(SUM(quantity), 0) INTO v_total_product_stock
    FROM public.stk_stock_levels WHERE product_id = v_pid;

    UPDATE public.stk_products
    SET quantity = v_total_product_stock, updated_at = now()
    WHERE id::text = v_pid;

    v_new_items := v_new_items || jsonb_build_array(
      v_line || jsonb_build_object(
        'line_status', 'CANCELLED',
        'quantity_received', 0,
        'quantity_pending', 0
      )
    );
  END LOOP;

  v_comments := COALESCE(v_trf.comments_history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'at', now(),
      'role', 'SENDER',
      'user_id', v_caller_id,
      'user_name', v_caller_name,
      'action', 'CANCELLED',
      'comment', COALESCE(NULLIF(TRIM(p_note), ''), 'Transfert annulé avant réception')
    )
  );

  UPDATE public.stk_transfers
  SET status = 'CANCELLED',
      items = v_new_items,
      resolution_note = NULLIF(TRIM(p_note), ''),
      comments_history = v_comments,
      updated_at = now()
  WHERE id = v_trf.id;

  INSERT INTO public.core_audit_logs (
    id, app, type, action, category, severity,
    user_id, user_name, user_trigram,
    depot_name, table_name, record_id,
    title, description, meta, created_at
  ) VALUES (
    'AUD-TRF-CAN-' || v_trf.id || '-' || substr(md5(random()::text), 1, 6),
    'stock',
    'STOCK_TRANSFER_CANCELLED',
    'STOCK_TRANSFER_CANCELLED',
    'MOVEMENTS',
    'INFO',
    v_caller_id, v_caller_name, v_caller_trigram,
    v_trf.source_depot, 'stk_transfers', v_trf.id,
    format('Transfert annulé : %s', v_trf.transfer_number),
    format('Annulation du transfert %s (%s → %s) par %s — stock réintégré à la source',
      v_trf.transfer_number, v_trf.source_depot, v_trf.dest_depot, v_caller_name),
    jsonb_build_object(
      'transfer_id', v_trf.id,
      'transfer_number', v_trf.transfer_number,
      'status', 'CANCELLED',
      'note', NULLIF(TRIM(p_note), '')
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_trf.id,
    'transfer_number', v_trf.transfer_number,
    'status', 'CANCELLED'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_stock_transfer(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_stock_transfer(TEXT, TEXT) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 9. RPC public.confirm_stock_transfer_adjustment (CONFIRMATION OU CONTESTATION PAR L'EXPÉDITEUR)
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.confirm_stock_transfer_adjustment(TEXT, BOOLEAN, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.confirm_stock_transfer_adjustment(
  p_transfer_id TEXT,
  p_confirm BOOLEAN,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_role INT;
  v_caller_name TEXT;
  v_caller_trigram TEXT;
  v_trf public.stk_transfers%ROWTYPE;
  v_clean_comment TEXT := NULLIF(TRIM(COALESCE(p_comment, '')), '');
  v_line JSONB;
  v_pid TEXT;
  v_qty_pending NUMERIC;
  v_total_product_stock NUMERIC;
  v_new_items JSONB := '[]'::jsonb;
  v_new_status TEXT;
  v_audit_type TEXT;
  v_audit_severity TEXT;
  v_comments JSONB;
BEGIN
  IF current_user = 'anon' OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'anon' THEN
    RAISE EXCEPTION 'Accès refusé : rôle anonyme interdit.' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT id::text, role_id, name, trigram
  INTO v_caller_id, v_caller_role, v_caller_name, v_caller_trigram
  FROM public.core_users
  WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
  LIMIT 1;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Profil utilisateur introuvable ou compte bloqué.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_trf
  FROM public.stk_transfers
  WHERE id = TRIM(COALESCE(p_transfer_id, ''))
     OR transfer_number = TRIM(COALESCE(p_transfer_id, ''))
  FOR UPDATE;

  IF v_trf.id IS NULL THEN
    RAISE EXCEPTION 'Transfert introuvable (%).', COALESCE(p_transfer_id, 'NULL') USING ERRCODE = 'P0002';
  END IF;

  IF v_trf.status <> 'AWAITING_SENDER' THEN
    RAISE EXCEPTION 'Ce transfert (%) n''est pas en attente de confirmation de l''expéditeur (statut : %).',
      v_trf.transfer_number, v_trf.status
      USING ERRCODE = '22023';
  END IF;

  -- Jamais par le receveur qui a modifié la quantité
  IF v_trf.receiver_id = v_caller_id AND NOT (public.is_super_admin() OR v_caller_role IN (0, 1)) THEN
    RAISE EXCEPTION 'Séparation des tâches : le receveur qui a modifié la quantité ne peut pas confirmer lui-même cet écart.'
      USING ERRCODE = '42501';
  END IF;

  -- Autorisé uniquement pour l'expéditeur, un autre responsable « envoi » du dépôt source ou un admin
  IF NOT (
    v_trf.sender_id = v_caller_id
    OR public.is_super_admin()
    OR v_caller_role IN (0, 1)
    OR EXISTS (
      SELECT 1 FROM public.stk_depot_holders h
      WHERE (h.depot_id = v_trf.source_depot_id OR LOWER(TRIM(h.depot_id)) = LOWER(TRIM(v_trf.source_depot)))
        AND h.user_id = v_caller_id
        AND h.can_send = true
    )
  ) THEN
    RAISE EXCEPTION 'Accès refusé : seul l''expéditeur, un responsable « envoi » du dépôt source "%" ou un administrateur peut confirmer ou contester cet écart.',
      v_trf.source_depot
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(p_confirm, false) = false AND v_clean_comment IS NULL THEN
    RAISE EXCEPTION 'Un commentaire est obligatoire pour contester l''écart de réception.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.stock_rpc', 'on', true);

  IF COALESCE(p_confirm, false) = true THEN
    -- L'expéditeur confirme : la différence retourne en stock à la source
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_trf.items)
    LOOP
      v_pid := v_line->>'product_id';
      v_qty_pending := COALESCE((v_line->>'quantity_pending')::numeric, 0);

      IF v_qty_pending > 0 THEN
        INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, updated_at)
        VALUES (v_pid, v_trf.source_depot, v_qty_pending, now())
        ON CONFLICT (product_id, depot_name) DO UPDATE
        SET quantity = public.stk_stock_levels.quantity + EXCLUDED.quantity,
            updated_at = now();

        SELECT COALESCE(SUM(quantity), 0) INTO v_total_product_stock
        FROM public.stk_stock_levels WHERE product_id = v_pid;

        UPDATE public.stk_products
        SET quantity = v_total_product_stock, updated_at = now()
        WHERE id::text = v_pid;

        v_new_items := v_new_items || jsonb_build_array(
          v_line || jsonb_build_object(
            'quantity_pending', 0,
            'sender_confirmed', true,
            'sender_comment', v_clean_comment,
            'line_status', 'ADJUSTMENT_CONFIRMED'
          )
        );
      ELSE
        v_new_items := v_new_items || jsonb_build_array(v_line);
      END IF;
    END LOOP;

    v_new_status := 'PARTIALLY_RECEIVED';
    v_audit_type := 'STOCK_TRANSFER_ADJUSTMENT_CONFIRMED';
    v_audit_severity := 'INFO';
  ELSE
    -- L'expéditeur conteste : passage en DISPUTED pour arbitrage logistique
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_trf.items)
    LOOP
      v_qty_pending := COALESCE((v_line->>'quantity_pending')::numeric, 0);
      IF v_qty_pending > 0 THEN
        v_new_items := v_new_items || jsonb_build_array(
          v_line || jsonb_build_object(
            'sender_confirmed', false,
            'sender_comment', v_clean_comment,
            'line_status', 'DISPUTED'
          )
        );
      ELSE
        v_new_items := v_new_items || jsonb_build_array(v_line);
      END IF;
    END LOOP;

    v_new_status := 'DISPUTED';
    v_audit_type := 'STOCK_TRANSFER_DISPUTED';
    v_audit_severity := 'WARNING';
  END IF;

  v_comments := COALESCE(v_trf.comments_history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'at', now(),
      'role', 'SENDER',
      'user_id', v_caller_id,
      'user_name', v_caller_name,
      'action', CASE WHEN COALESCE(p_confirm, false) THEN 'ADJUSTMENT_CONFIRMED' ELSE 'DISPUTED' END,
      'comment', COALESCE(v_clean_comment, 'Écart de quantité confirmé par l''expéditeur')
    )
  );

  UPDATE public.stk_transfers
  SET status = v_new_status,
      items = v_new_items,
      sender_confirmed_by = v_caller_id,
      sender_confirmed_by_name = v_caller_name,
      sender_confirmed_at = now(),
      sender_comment = v_clean_comment,
      comments_history = v_comments,
      updated_at = now()
  WHERE id = v_trf.id;

  INSERT INTO public.core_audit_logs (
    id, app, type, action, category, severity,
    user_id, user_name, user_trigram,
    depot_name, table_name, record_id,
    title, description, meta, created_at
  ) VALUES (
    'AUD-TRF-ADJ-' || v_trf.id || '-' || substr(md5(random()::text), 1, 6),
    'stock',
    v_audit_type,
    v_audit_type,
    'MOVEMENTS',
    v_audit_severity,
    v_caller_id, v_caller_name, v_caller_trigram,
    v_trf.source_depot, 'stk_transfers', v_trf.id,
    CASE
      WHEN COALESCE(p_confirm, false) THEN format('Écart confirmé sur %s', v_trf.transfer_number)
      ELSE format('Litige ouvert sur %s', v_trf.transfer_number)
    END,
    CASE
      WHEN COALESCE(p_confirm, false) THEN format('Confirmation de l''écart de réception sur %s par %s (différence réintégrée à %s)', v_trf.transfer_number, v_caller_name, v_trf.source_depot)
      ELSE format('Contestation de l''écart de réception sur %s par %s — Motif : %s', v_trf.transfer_number, v_caller_name, v_clean_comment)
    END,
    jsonb_build_object(
      'transfer_id', v_trf.id,
      'transfer_number', v_trf.transfer_number,
      'confirmed', COALESCE(p_confirm, false),
      'status', v_new_status,
      'comment', v_clean_comment,
      'items', v_new_items
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_trf.id,
    'transfer_number', v_trf.transfer_number,
    'status', v_new_status,
    'confirmed', COALESCE(p_confirm, false),
    'items', v_new_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_stock_transfer_adjustment(TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_stock_transfer_adjustment(TEXT, BOOLEAN, TEXT) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 10. RPC public.resolve_transfer_dispute (ARBITRAGE LOGISTIQUE)
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.resolve_transfer_dispute(TEXT, TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.resolve_transfer_dispute(
  p_transfer_id TEXT,
  p_action TEXT,
  p_comment TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_role INT;
  v_caller_name TEXT;
  v_caller_trigram TEXT;
  v_trf public.stk_transfers%ROWTYPE;
  v_clean_action TEXT := UPPER(TRIM(COALESCE(p_action, '')));
  v_clean_comment TEXT := NULLIF(TRIM(COALESCE(p_comment, '')), '');
  v_line JSONB;
  v_pid TEXT;
  v_pref TEXT;
  v_qty_pending NUMERIC;
  v_unit_price NUMERIC;
  v_total_product_stock NUMERIC;
  v_new_items JSONB := '[]'::jsonb;
  v_comments JSONB;
BEGIN
  IF current_user = 'anon' OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'anon' THEN
    RAISE EXCEPTION 'Accès refusé : rôle anonyme interdit.' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT id::text, role_id, name, trigram
  INTO v_caller_id, v_caller_role, v_caller_name, v_caller_trigram
  FROM public.core_users
  WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
  LIMIT 1;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Profil utilisateur introuvable ou compte bloqué.' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.is_super_admin()
    OR v_caller_role IN (0, 1)
    OR public.current_user_has_perm('perm_stock_receive_all')
  ) THEN
    RAISE EXCEPTION 'Permission refusée : perm_stock_receive_all (ou rôle Administrateur) requise pour arbitrer un litige de transfert.'
      USING ERRCODE = '42501';
  END IF;

  IF v_clean_action NOT IN ('RETURN_TO_SOURCE', 'WRITE_OFF') THEN
    RAISE EXCEPTION 'Action d''arbitrage invalide (%) : valeurs autorisées RETURN_TO_SOURCE ou WRITE_OFF.', p_action
      USING ERRCODE = '22023';
  END IF;

  IF v_clean_comment IS NULL THEN
    RAISE EXCEPTION 'Un commentaire d''arbitrage est obligatoire pour résoudre un litige.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_trf
  FROM public.stk_transfers
  WHERE id = TRIM(COALESCE(p_transfer_id, ''))
     OR transfer_number = TRIM(COALESCE(p_transfer_id, ''))
  FOR UPDATE;

  IF v_trf.id IS NULL THEN
    RAISE EXCEPTION 'Transfert introuvable (%).', COALESCE(p_transfer_id, 'NULL') USING ERRCODE = 'P0002';
  END IF;

  IF v_trf.status <> 'DISPUTED' THEN
    RAISE EXCEPTION 'Ce transfert (%) n''est pas en litige (statut actuel : %).',
      v_trf.transfer_number, v_trf.status
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.stock_rpc', 'on', true);

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_trf.items)
  LOOP
    v_pid := v_line->>'product_id';
    v_pref := COALESCE(v_line->>'product_ref', v_pid);
    v_qty_pending := COALESCE((v_line->>'quantity_pending')::numeric, 0);
    v_unit_price := COALESCE((v_line->>'unit_price')::numeric, 0);

    IF v_qty_pending > 0 THEN
      IF v_clean_action = 'RETURN_TO_SOURCE' THEN
        INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, updated_at)
        VALUES (v_pid, v_trf.source_depot, v_qty_pending, now())
        ON CONFLICT (product_id, depot_name) DO UPDATE
        SET quantity = public.stk_stock_levels.quantity + EXCLUDED.quantity,
            updated_at = now();

        SELECT COALESCE(SUM(quantity), 0) INTO v_total_product_stock
        FROM public.stk_stock_levels WHERE product_id = v_pid;

        UPDATE public.stk_products
        SET quantity = v_total_product_stock, updated_at = now()
        WHERE id::text = v_pid;
      ELSE
        -- WRITE_OFF : la différence est définitivement enregistrée en perte
        INSERT INTO public.stk_movements (
          id, product_id, product_ref, user_id, user_name, movement_type,
          quantity_changed, reason, site_number, department_name, total_cost,
          depot_name, dest_depot_name, created_at
        ) VALUES (
          'MOV-TRF-LOSS-' || v_trf.id || '-' || v_pid,
          v_pid, v_pref, v_caller_id, v_caller_name, 'OUT',
          v_qty_pending,
          format('[PERTE LITIGE %s] %s', v_trf.transfer_number, v_clean_comment),
          'PERTE LITIGE TRANSFERT',
          'Logistique',
          ROUND(v_qty_pending * v_unit_price, 2),
          v_trf.source_depot,
          v_trf.dest_depot,
          now()
        );
      END IF;

      v_new_items := v_new_items || jsonb_build_array(
        v_line || jsonb_build_object(
          'quantity_pending', 0,
          'dispute_resolution', v_clean_action,
          'dispute_comment', v_clean_comment,
          'line_status', 'DISPUTE_RESOLVED_' || v_clean_action
        )
      );
    ELSE
      v_new_items := v_new_items || jsonb_build_array(v_line);
    END IF;
  END LOOP;

  v_comments := COALESCE(v_trf.comments_history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'at', now(),
      'role', 'LOGISTICS',
      'user_id', v_caller_id,
      'user_name', v_caller_name,
      'action', 'DISPUTE_RESOLVED_' || v_clean_action,
      'comment', v_clean_comment
    )
  );

  UPDATE public.stk_transfers
  SET status = 'PARTIALLY_RECEIVED',
      items = v_new_items,
      resolved_by = v_caller_id,
      resolved_by_name = v_caller_name,
      resolved_at = now(),
      resolution_action = v_clean_action,
      resolution_note = v_clean_comment,
      comments_history = v_comments,
      updated_at = now()
  WHERE id = v_trf.id;

  INSERT INTO public.core_audit_logs (
    id, app, type, action, category, severity,
    user_id, user_name, user_trigram,
    depot_name, table_name, record_id,
    title, description, meta, created_at
  ) VALUES (
    'AUD-TRF-RES-' || v_trf.id || '-' || substr(md5(random()::text), 1, 6),
    'stock',
    'STOCK_TRANSFER_DISPUTE_RESOLVED',
    'STOCK_TRANSFER_DISPUTE_RESOLVED',
    'MOVEMENTS',
    'WARNING',
    v_caller_id, v_caller_name, v_caller_trigram,
    v_trf.source_depot, 'stk_transfers', v_trf.id,
    format('Litige résolu sur %s (%s)', v_trf.transfer_number, v_clean_action),
    format('Arbitrage logistique sur %s par %s : %s — Commentaire : %s',
      v_trf.transfer_number, v_caller_name, v_clean_action, v_clean_comment),
    jsonb_build_object(
      'transfer_id', v_trf.id,
      'transfer_number', v_trf.transfer_number,
      'resolution_action', v_clean_action,
      'resolution_note', v_clean_comment,
      'items', v_new_items
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_trf.id,
    'transfer_number', v_trf.transfer_number,
    'status', 'PARTIALLY_RECEIVED',
    'resolution_action', v_clean_action,
    'resolution_note', v_clean_comment,
    'items', v_new_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_transfer_dispute(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_transfer_dispute(TEXT, TEXT, TEXT) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 11. RPC public.list_overdue_transfers (TRANSFERTS EN TRANSIT DEPUIS > X HEURES)
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_overdue_transfers(INTEGER) CASCADE;
CREATE OR REPLACE FUNCTION public.list_overdue_transfers(
  p_hours INTEGER DEFAULT 48
)
RETURNS SETOF public.stk_transfers
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_role INT;
  v_threshold INTERVAL;
BEGIN
  IF current_user = 'anon' OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'anon' THEN
    RAISE EXCEPTION 'Accès refusé : rôle anonyme interdit.' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT id::text, role_id
  INTO v_caller_id, v_caller_role
  FROM public.core_users
  WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
  LIMIT 1;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Profil utilisateur introuvable ou compte bloqué.' USING ERRCODE = '42501';
  END IF;

  v_threshold := make_interval(hours => GREATEST(COALESCE(p_hours, 48), 1));

  RETURN QUERY
  SELECT t.*
  FROM public.stk_transfers t
  WHERE t.status IN ('IN_TRANSIT', 'AWAITING_SENDER', 'DISPUTED')
    AND t.created_at <= (now() - v_threshold)
    AND (
      public.is_super_admin()
      OR v_caller_role IN (0, 1)
      OR public.current_user_has_perm('perm_stock_receive_all')
      OR t.sender_id = v_caller_id
      OR EXISTS (
        SELECT 1 FROM public.stk_depot_holders h
        WHERE (
          h.depot_id IN (t.source_depot_id, t.dest_depot_id)
          OR LOWER(TRIM(h.depot_id)) IN (LOWER(TRIM(t.source_depot)), LOWER(TRIM(t.dest_depot)))
        )
        AND h.user_id = v_caller_id
        AND (h.can_send = true OR h.can_receive = true)
      )
    )
  ORDER BY t.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_overdue_transfers(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_overdue_transfers(INTEGER) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 12. RPC public.get_stock_levels_report (RAPPORTS DE NIVEAU DE STOCK — LOGISTIQUE)
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_stock_levels_report(TEXT, BOOLEAN) CASCADE;
CREATE OR REPLACE FUNCTION public.get_stock_levels_report(
  p_depot TEXT DEFAULT NULL,
  p_only_low BOOLEAN DEFAULT false
)
RETURNS TABLE (
  product_id TEXT,
  reference TEXT,
  brand TEXT,
  model TEXT,
  sub_category_id INT,
  depot_name TEXT,
  rack_location TEXT,
  quantity NUMERIC,
  min_stock_alert NUMERIC,
  unit_price NUMERIC,
  total_value NUMERIC,
  in_transit_qty NUMERIC,
  is_low_stock BOOLEAN,
  is_out_of_stock BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id TEXT;
  v_caller_role INT;
  v_can_view_prices BOOLEAN;
  v_depot_filter TEXT := NULLIF(TRIM(COALESCE(p_depot, '')), '');
BEGIN
  IF current_user = 'anon' OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'anon' THEN
    RAISE EXCEPTION 'Accès refusé : rôle anonyme interdit.' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT id::text, role_id
  INTO v_caller_id, v_caller_role
  FROM public.core_users
  WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
  LIMIT 1;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Profil utilisateur introuvable ou compte bloqué.' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.is_super_admin()
    OR v_caller_role IN (0, 1)
    OR public.current_user_has_perm('perm_report_stock_levels')
  ) THEN
    RAISE EXCEPTION 'Permission refusée : perm_report_stock_levels est requise pour consulter les rapports de niveau de stock.'
      USING ERRCODE = '42501';
  END IF;

  v_can_view_prices := (
    public.is_super_admin()
    OR v_caller_role IN (0, 1)
    OR public.current_user_has_perm('perm_prod_view_price')
  );

  IF v_depot_filter IS NOT NULL AND UPPER(v_depot_filter) = 'ALL' THEN
    v_depot_filter := NULL;
  END IF;

  RETURN QUERY
  WITH transit_totals AS (
    SELECT
      (item->>'product_id')::text AS pid,
      SUM(COALESCE((item->>'quantity_sent')::numeric, (item->>'quantity')::numeric, 0)) AS transit_qty
    FROM public.stk_transfers t,
         jsonb_array_elements(t.items) AS item
    WHERE t.status = 'IN_TRANSIT'
      AND (
        v_depot_filter IS NULL
        OR LOWER(TRIM(t.source_depot)) = LOWER(v_depot_filter)
        OR LOWER(TRIM(t.dest_depot)) = LOWER(v_depot_filter)
      )
    GROUP BY (item->>'product_id')::text
  ),
  product_rows AS (
    SELECT
      p.id::text AS product_id,
      COALESCE(p.reference, p.id::text) AS reference,
      COALESCE(p.brand, '') AS brand,
      COALESCE(p.model, '') AS model,
      p.sub_category_id::int AS sub_category_id,
      COALESCE(
        CASE WHEN v_depot_filter IS NOT NULL THEN sl.depot_name ELSE COALESCE(NULLIF(TRIM(p.store_name), ''), 'Dépôt Principal') END,
        'Dépôt Principal'
      ) AS depot_name,
      COALESCE(
        CASE WHEN v_depot_filter IS NOT NULL THEN COALESCE(sl.rack_location, p.shelf_name) ELSE p.shelf_name END,
        ''
      ) AS rack_location,
      COALESCE(
        CASE WHEN v_depot_filter IS NOT NULL THEN sl.quantity ELSE p.quantity END,
        0
      )::numeric AS quantity,
      COALESCE(
        CASE WHEN v_depot_filter IS NOT NULL THEN COALESCE(sl.min_alert, p.min_stock_alert) ELSE p.min_stock_alert END,
        0
      )::numeric AS min_stock_alert,
      CASE WHEN v_can_view_prices THEN COALESCE(p.unit_price, 0)::numeric ELSE 0::numeric END AS unit_price,
      COALESCE(tr.transit_qty, 0)::numeric AS in_transit_qty
    FROM public.stk_products p
    LEFT JOIN public.stk_stock_levels sl
      ON v_depot_filter IS NOT NULL
     AND sl.product_id = p.id::text
     AND LOWER(TRIM(sl.depot_name)) = LOWER(v_depot_filter)
    LEFT JOIN transit_totals tr ON tr.pid = p.id::text
    WHERE v_depot_filter IS NULL
       OR sl.product_id IS NOT NULL
       OR LOWER(TRIM(COALESCE(p.store_name, ''))) = LOWER(v_depot_filter)
  )
  SELECT
    pr.product_id,
    pr.reference,
    pr.brand,
    pr.model,
    pr.sub_category_id,
    pr.depot_name,
    pr.rack_location,
    pr.quantity,
    pr.min_stock_alert,
    pr.unit_price,
    ROUND(pr.quantity * pr.unit_price, 2) AS total_value,
    pr.in_transit_qty,
    (pr.quantity <= pr.min_stock_alert) AS is_low_stock,
    (pr.quantity <= 0) AS is_out_of_stock
  FROM product_rows pr
  WHERE (NOT COALESCE(p_only_low, false))
     OR (pr.quantity <= pr.min_stock_alert)
  ORDER BY pr.reference ASC, pr.depot_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_stock_levels_report(TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stock_levels_report(TEXT, BOOLEAN) TO authenticated, service_role;
