-- =========================================================================
-- FICHIER GÉNÉRÉ AUTOMATIQUEMENT PAR scripts/build-sql.mjs — NE PAS MODIFIER DIRECTEMENT
-- Source de vérité : supabase-client/17_transferts_valides.sql
-- Étape 17 : Transferts validés à la réception, responsables de dépôt (stk_depot_holders, stk_transfers) & droits fins (17_transferts_valides.sql)
-- =========================================================================
-- =========================================================================
-- 17_transferts_valides.sql  (schéma 2.8.0)
-- Transferts inter-dépôts en deux temps (envoi -> en transit -> réception validée article par article : accepté, modifié (quantité réduite + commentaire) ou refusé ; toute modification de quantité doit être confirmée par l'expéditeur),
-- responsables par dépôt (plusieurs possibles, droits d'envoi / de réception séparés),
-- permissions fines (magasin, réception globale, rapports de niveau de stock).
-- Idempotent. Dépend des scripts 03/04 (stock), 13 (transfert direct) et 16 (audit).
-- =========================================================================

-- 1. Responsables de dépôt -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stk_depot_holders (
  depot_id    TEXT NOT NULL,  -- id du dépôt en texte (stk_depots.id peut être TEXT ou BIGINT selon l'historique de la base)
  user_id     TEXT NOT NULL,
  can_send    BOOLEAN NOT NULL DEFAULT true,
  can_receive BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,
  PRIMARY KEY (depot_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_depot_holders_user ON public.stk_depot_holders (user_id);

-- Suppression d'un dépôt => ses responsables sont retirés (sans clé étrangère : types d'id variables)
CREATE OR REPLACE FUNCTION public._tot_depot_holders_cleanup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN DELETE FROM public.stk_depot_holders WHERE depot_id = OLD.id::text; RETURN OLD; END $$;
DROP TRIGGER IF EXISTS trg_depot_holders_cleanup ON public.stk_depots;
CREATE TRIGGER trg_depot_holders_cleanup AFTER DELETE ON public.stk_depots
  FOR EACH ROW EXECUTE FUNCTION public._tot_depot_holders_cleanup();

-- 2. Transferts en deux temps ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.stk_transfers (
  id               TEXT PRIMARY KEY,
  batch_id         UUID UNIQUE,
  source_depot     TEXT NOT NULL,
  dest_depot       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'IN_TRANSIT',
  reason           TEXT,
  items            JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_pieces     NUMERIC NOT NULL DEFAULT 0,
  total_cost       NUMERIC NOT NULL DEFAULT 0,
  has_variance     BOOLEAN NOT NULL DEFAULT false,
  created_by       TEXT,
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by      TEXT,
  resolved_by_name TEXT,
  resolved_at      TIMESTAMPTZ,
  resolution_note  TEXT
);
-- Table stk_transfers déjà présente avec une ancienne structure : on complète les colonnes manquantes (sans rien supprimer)
ALTER TABLE public.stk_transfers ADD COLUMN IF NOT EXISTS batch_id UUID;
ALTER TABLE public.stk_transfers ADD COLUMN IF NOT EXISTS source_depot TEXT;
ALTER TABLE public.stk_transfers ADD COLUMN IF NOT EXISTS dest_depot TEXT;
ALTER TABLE public.stk_transfers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'IN_TRANSIT';
ALTER TABLE public.stk_transfers ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE public.stk_transfers ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.stk_transfers ADD COLUMN IF NOT EXISTS total_pieces NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.stk_transfers ADD COLUMN IF NOT EXISTS total_cost NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.stk_transfers ADD COLUMN IF NOT EXISTS has_variance BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.stk_transfers ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE public.stk_transfers ADD COLUMN IF NOT EXISTS created_by_name TEXT;
ALTER TABLE public.stk_transfers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.stk_transfers ADD COLUMN IF NOT EXISTS resolved_by TEXT;
ALTER TABLE public.stk_transfers ADD COLUMN IF NOT EXISTS resolved_by_name TEXT;
ALTER TABLE public.stk_transfers ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE public.stk_transfers ADD COLUMN IF NOT EXISTS resolution_note TEXT;
UPDATE public.stk_transfers SET status = 'IN_TRANSIT' WHERE status IS NULL OR status NOT IN ('IN_TRANSIT','AWAITING_SENDER','DISPUTED','RECEIVED','PARTIALLY_RECEIVED','REJECTED','CANCELLED');
ALTER TABLE public.stk_transfers DROP CONSTRAINT IF EXISTS stk_transfers_status_check;
ALTER TABLE public.stk_transfers ADD CONSTRAINT stk_transfers_status_check
  CHECK (status IN ('IN_TRANSIT','AWAITING_SENDER','DISPUTED','RECEIVED','PARTIALLY_RECEIVED','REJECTED','CANCELLED'));
CREATE INDEX IF NOT EXISTS idx_transfers_status_created ON public.stk_transfers (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_dest ON public.stk_transfers (dest_depot, status);
CREATE INDEX IF NOT EXISTS idx_transfers_source ON public.stk_transfers (source_depot, status);

-- 3. Fonctions utilitaires ---------------------------------------------------
CREATE OR REPLACE FUNCTION public._tot_is_admin01() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.current_user_role() IN (0, 1), false)
$$;

CREATE OR REPLACE FUNCTION public._tot_is_depot_holder(p_depot_name text, p_right text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.stk_depot_holders h
    JOIN public.stk_depots d ON d.id::text = h.depot_id
    WHERE d.name = p_depot_name AND h.user_id = public.current_user_id()
      AND CASE p_right WHEN 'send' THEN h.can_send WHEN 'receive' THEN h.can_receive ELSE false END)
$$;

-- 4. Sécurité des tables : lecture filtrée, écriture uniquement via fonctions -----
ALTER TABLE public.stk_depot_holders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stk_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read depot_holders" ON public.stk_depot_holders;
CREATE POLICY "Authenticated read depot_holders" ON public.stk_depot_holders FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated read transfers" ON public.stk_transfers;
CREATE POLICY "Authenticated read transfers" ON public.stk_transfers FOR SELECT TO authenticated USING (
  public._tot_is_admin01()
  OR created_by = public.current_user_id()
  OR public._tot_is_depot_holder(source_depot, 'send') OR public._tot_is_depot_holder(source_depot, 'receive')
  OR public._tot_is_depot_holder(dest_depot, 'send') OR public._tot_is_depot_holder(dest_depot, 'receive')
  OR public.current_user_has_perm('perm_stock_transfer_store')
  OR public.current_user_has_perm('perm_stock_receive_all')
);
REVOKE INSERT, UPDATE, DELETE ON public.stk_depot_holders FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.stk_transfers FROM anon, authenticated;

-- Audit automatique (script 16)
DO $$ BEGIN
  IF to_regprocedure('public._tot_audit_row()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_row ON public.stk_depot_holders;
    CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.stk_depot_holders
      FOR EACH ROW EXECUTE FUNCTION public._tot_audit_row('DEPOTS', 'Responsable de dépôt', 'user_id');
    -- stk_transfers : événements explicites (complets) écrits par les fonctions ci-dessous, pas de déclencheur générique
    DROP TRIGGER IF EXISTS trg_audit_row ON public.stk_transfers;
  END IF;
END $$;

-- 5. Nouvelles permissions attribuées aux rôles 1 (administrateur) et 6 (logistique) -----
UPDATE public.core_roles r
SET permissions = (SELECT array_agg(DISTINCT p) FROM unnest(r.permissions || ARRAY[
      'perm_stock_transfer_store','perm_stock_receive_all','perm_report_stock_levels']) p)
WHERE r.id::text IN ('1','6')
  AND NOT (r.permissions @> ARRAY['perm_stock_transfer_store','perm_stock_receive_all','perm_report_stock_levels']);

-- 6. Gestion des responsables ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_depot_holders(p_depot_id text, p_holders jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller text := public.current_user_id(); h jsonb; v_uid text; v_n int := 0;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501'; END IF;
  IF NOT (public._tot_is_admin01() OR public.current_user_has_perm('perm_manage_depots')) THEN
    RAISE EXCEPTION 'Droit insuffisant : gestion des responsables de dépôt' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stk_depots WHERE id::text = p_depot_id) THEN
    RAISE EXCEPTION 'Dépôt introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF p_holders IS NULL OR jsonb_typeof(p_holders) <> 'array' THEN
    RAISE EXCEPTION 'p_holders doit être un tableau JSON' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.stk_depot_holders
  WHERE depot_id = p_depot_id
    AND user_id NOT IN (SELECT x->>'user_id' FROM jsonb_array_elements(p_holders) x);
  FOR h IN SELECT * FROM jsonb_array_elements(p_holders) LOOP
    v_uid := NULLIF(trim(h->>'user_id'), '');
    IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.core_users WHERE id::text = v_uid AND COALESCE(is_blocked,false) = false) THEN
      RAISE EXCEPTION 'Utilisateur invalide ou bloqué : %', COALESCE(v_uid, '(vide)') USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.stk_depot_holders (depot_id, user_id, can_send, can_receive, created_by)
    VALUES (p_depot_id, v_uid, COALESCE((h->>'can_send')::boolean, true), COALESCE((h->>'can_receive')::boolean, true), v_caller)
    ON CONFLICT (depot_id, user_id) DO UPDATE SET can_send = EXCLUDED.can_send, can_receive = EXCLUDED.can_receive;
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'depot_id', p_depot_id, 'holders', v_n);
END $$;

-- Journal d'audit des transferts (événements complets, jamais bloquants)
CREATE OR REPLACE FUNCTION public._tot_transfer_audit(
  p_type text, p_title text, p_desc text, p_severity text, p_meta jsonb, p_uid text, p_name text, p_depot text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.core_audit_logs (id, app, type, category, user_id, user_name, depot_name, title, description,
      meta, action, severity, details, ip_address, created_at)
  VALUES ('AUD-' || replace(gen_random_uuid()::text, '-', ''), 'stock', p_type, 'MOVEMENTS', p_uid, p_name, p_depot,
      left(p_title, 200), left(p_desc, 500), p_meta, p_type, p_severity, '{}'::jsonb,
      CASE WHEN to_regprocedure('public._tot_audit_ip()') IS NOT NULL THEN public._tot_audit_ip() END, now());
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit transfert non enregistré : %', SQLERRM;
END $$;

-- 7. Retour de stock à la source (annulation / refus / écart) ------------------------
CREATE OR REPLACE FUNCTION public._tot_transfer_give_back(
  p_transfer_id text, p_source text, p_product_id text, p_product_ref text, p_qty numeric,
  p_reason text, p_user_id text, p_user_name text, p_dest text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total numeric;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RETURN; END IF;
  PERFORM set_config('app.stock_rpc', 'on', true);
  INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, updated_at)
  VALUES (p_product_id, p_source, p_qty, now())
  ON CONFLICT (product_id, depot_name) DO UPDATE SET quantity = public.stk_stock_levels.quantity + p_qty, updated_at = now();
  SELECT COALESCE(SUM(quantity),0) INTO v_total FROM public.stk_stock_levels WHERE product_id = p_product_id;
  UPDATE public.stk_products SET quantity = v_total, updated_at = now() WHERE id::text = p_product_id;
  INSERT INTO public.stk_movements (id, product_id, product_ref, user_id, user_name, movement_type, quantity_changed,
      reason, site_number, department_name, total_cost, depot_name, dest_depot_name, created_at)
  VALUES ('MOV-' || p_transfer_id || '-BACK-' || substr(md5(p_product_id || clock_timestamp()::text), 1, 6),
      p_product_id, p_product_ref, p_user_id, p_user_name, 'IN', p_qty, p_reason,
      format('RETOUR TRANSFERT <- %s', p_dest), 'Logistique', 0, p_source, NULL, now());
END $$;

-- 8. Envoi : le stock quitte la source et passe « en transit » ---------------------------
CREATE OR REPLACE FUNCTION public.send_stock_transfer(
  p_batch_id uuid, p_source_depot text, p_dest_depot text, p_items jsonb, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid text; v_name text; v_dept text; v_blocked boolean; v_src_type text;
  v_existing public.stk_transfers; v_id text; v_idx int; v_item jsonb; v_pid text; v_qty numeric;
  v_ref text; v_price numeric; v_cur numeric; v_total numeric; v_cost numeric := 0; v_pieces numeric := 0;
  v_applied jsonb := '[]'::jsonb; v_reason text; v_n int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501'; END IF;
  SELECT id::text, name, department, COALESCE(is_blocked,false) INTO v_uid, v_name, v_dept, v_blocked
  FROM public.core_users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_uid IS NULL OR v_blocked THEN RAISE EXCEPTION 'Profil introuvable ou bloqué' USING ERRCODE = '42501'; END IF;
  IF p_batch_id IS NULL THEN RAISE EXCEPTION 'Identifiant de lot requis' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_existing FROM public.stk_transfers WHERE batch_id = p_batch_id;
  IF FOUND THEN
    IF v_existing.created_by IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'Identifiant de lot déjà utilisé par un autre utilisateur' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'transfer_id', v_existing.id, 'status', v_existing.status,
      'batch_id', p_batch_id, 'source_depot', v_existing.source_depot, 'dest_depot', v_existing.dest_depot,
      'item_count', jsonb_array_length(v_existing.items), 'total_pieces', v_existing.total_pieces, 'items', v_existing.items);
  END IF;

  p_source_depot := NULLIF(trim(COALESCE(p_source_depot,'')), '');
  p_dest_depot := NULLIF(trim(COALESCE(p_dest_depot,'')), '');
  IF p_source_depot IS NULL OR p_dest_depot IS NULL THEN RAISE EXCEPTION 'Dépôt source et destination requis' USING ERRCODE = '22023'; END IF;
  IF p_source_depot = p_dest_depot THEN RAISE EXCEPTION 'Le dépôt de destination doit être différent de la source' USING ERRCODE = '22023'; END IF;
  SELECT COUNT(*) INTO v_n FROM public.stk_depots WHERE name IN (p_source_depot, p_dest_depot) AND COALESCE(is_active, true);
  IF v_n < 2 THEN RAISE EXCEPTION 'Dépôt source ou destination introuvable, fermé ou inactif' USING ERRCODE = '22023'; END IF;

  SELECT COALESCE(type,'FIXED') INTO v_src_type FROM public.stk_depots WHERE name = p_source_depot;
  IF NOT (public._tot_is_admin01()
       OR public._tot_is_depot_holder(p_source_depot, 'send')
       OR (v_src_type = 'FIXED' AND public.current_user_has_perm('perm_stock_transfer_store'))) THEN
    RAISE EXCEPTION 'Transfert refusé : vous n''êtes pas responsable (envoi) du dépôt « % ».', p_source_depot USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stk_depot_holders h JOIN public.stk_depots d ON d.id::text = h.depot_id
                 WHERE d.name = p_dest_depot AND h.can_receive) THEN
    RAISE EXCEPTION 'Le dépôt « % » n''a aucun responsable de réception : demandez à la logistique d''en désigner un.', p_dest_depot USING ERRCODE = '22023';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Le lot doit contenir entre 1 et 200 articles' USING ERRCODE = '22023';
  END IF;

  v_reason := COALESCE(NULLIF(trim(COALESCE(p_reason,'')), ''), format('Transfert %s -> %s', p_source_depot, p_dest_depot));
  v_id := 'TRF-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || substr(md5(p_batch_id::text), 1, 8);
  PERFORM set_config('app.stock_rpc', 'on', true);

  FOR v_idx IN 0 .. jsonb_array_length(p_items) - 1 LOOP
    v_item := p_items -> v_idx;
    v_pid := NULLIF(trim(COALESCE(v_item->>'product_id','')), '');
    IF v_pid IS NULL THEN RAISE EXCEPTION 'product_id manquant (ligne %)', v_idx + 1 USING ERRCODE = '22023'; END IF;
    BEGIN v_qty := (v_item->>'quantity')::numeric; EXCEPTION WHEN OTHERS THEN v_qty := NULL; END;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantité invalide pour % (ligne %)', v_pid, v_idx + 1 USING ERRCODE = '22023'; END IF;

    SELECT reference, unit_price INTO v_ref, v_price FROM public.stk_products WHERE id::text = v_pid FOR UPDATE;
    IF v_ref IS NULL THEN RAISE EXCEPTION 'Article introuvable (%)', v_pid USING ERRCODE = 'P0002'; END IF;

    SELECT quantity INTO v_cur FROM public.stk_stock_levels WHERE product_id = v_pid AND depot_name = p_source_depot FOR UPDATE;
    IF v_cur IS NULL OR v_cur < v_qty THEN
      RAISE EXCEPTION 'Stock insuffisant dans « % » pour % (disponible : %, demandé : %)',
        p_source_depot, v_ref, COALESCE(v_cur, 0), v_qty USING ERRCODE = '23514';
    END IF;
    UPDATE public.stk_stock_levels SET quantity = quantity - v_qty, updated_at = now()
      WHERE product_id = v_pid AND depot_name = p_source_depot;
    SELECT COALESCE(SUM(quantity),0) INTO v_total FROM public.stk_stock_levels WHERE product_id = v_pid;
    UPDATE public.stk_products SET quantity = v_total, updated_at = now() WHERE id::text = v_pid;

    INSERT INTO public.stk_movements (id, product_id, product_ref, user_id, user_name, movement_type, quantity_changed,
        reason, site_number, department_name, total_cost, depot_name, dest_depot_name, created_at)
    VALUES ('MOV-' || v_id || '-' || (v_idx + 1), v_pid, v_ref, v_uid, v_name, 'OUT', v_qty,
        v_reason || ' (en transit)', format('TRANSIT -> %s', p_dest_depot), COALESCE(v_dept, 'Logistique'),
        ROUND(v_qty * COALESCE(v_price, 0), 2), p_source_depot, p_dest_depot, now());

    v_cost := v_cost + ROUND(v_qty * COALESCE(v_price, 0), 2);
    v_pieces := v_pieces + v_qty;
    v_applied := v_applied || jsonb_build_array(jsonb_build_object(
      'product_id', v_pid, 'product_ref', v_ref, 'quantity', v_qty,
      'dest_rack', NULLIF(trim(COALESCE(v_item->>'dest_rack','')), ''), 'unit_price', COALESCE(v_price, 0)));
  END LOOP;

  INSERT INTO public.stk_transfers (id, batch_id, source_depot, dest_depot, status, reason, items, total_pieces, total_cost, created_by, created_by_name)
  VALUES (v_id, p_batch_id, p_source_depot, p_dest_depot, 'IN_TRANSIT', v_reason, v_applied, v_pieces, v_cost, v_uid, v_name);

  PERFORM public._tot_transfer_audit('STOCK_TRANSFER_SENT', 'Transfert envoyé (en transit)',
    format('%s : %s → %s, %s article(s), %s pièce(s), envoyé par %s', v_id, p_source_depot, p_dest_depot, jsonb_array_length(v_applied), v_pieces, v_name),
    'INFO', jsonb_build_object('transfer_id', v_id, 'source', p_source_depot, 'dest', p_dest_depot, 'reason', v_reason, 'items', v_applied),
    v_uid, v_name, p_source_depot);
  RETURN jsonb_build_object('success', true, 'transfer_id', v_id, 'status', 'IN_TRANSIT', 'batch_id', p_batch_id,
    'source_depot', p_source_depot, 'dest_depot', p_dest_depot, 'reason', v_reason,
    'item_count', jsonb_array_length(v_applied), 'total_pieces', v_pieces, 'total_cost', v_cost,
    'items', v_applied, 'timestamp', now());
END $$;

-- 9. Réception ligne par ligne -----------------------------------------------------------------------------
-- p_items : [{ "product_id": "...", "accepted": true|false (défaut true),
--              "quantity_received": n (optionnel, 0 < n < quantité envoyée => article MODIFIÉ),
--              "reason": "commentaire" (obligatoire si refusé ou modifié) }]
-- * Accepté        : la quantité envoyée entre dans le dépôt.
-- * Modifié        : la quantité reçue entre dans le dépôt ; la différence reste « en attente » (hors stock) jusqu'à ce que
--                    l'EXPÉDITEUR confirme la modification (confirm_stock_transfer_adjustment). Statut AWAITING_SENDER.
-- * Refusé         : l'article retourne immédiatement à la source (motif obligatoire).
CREATE OR REPLACE FUNCTION public.receive_stock_transfer(p_transfer_id text, p_items jsonb DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid text; v_name text; v_blocked boolean; t public.stk_transfers; it jsonb; v_new jsonb := '[]'::jsonb;
  v_qty numeric; v_recv numeric; v_pid text; v_ref text; v_total numeric; v_rack text; v_price numeric; v_ov jsonb;
  v_acc boolean; v_reason text; v_i int := 0; v_n_ok int := 0; v_n_mod int := 0; v_n_ko int := 0; v_status text; v_src_after numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501'; END IF;
  SELECT id::text, name, COALESCE(is_blocked,false) INTO v_uid, v_name, v_blocked FROM public.core_users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_uid IS NULL OR v_blocked THEN RAISE EXCEPTION 'Profil introuvable ou bloqué' USING ERRCODE = '42501'; END IF;

  SELECT * INTO t FROM public.stk_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfert introuvable' USING ERRCODE = 'P0002'; END IF;
  IF t.status IN ('AWAITING_SENDER','DISPUTED','RECEIVED','PARTIALLY_RECEIVED','REJECTED') AND t.resolved_by IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'transfer_id', t.id, 'status', t.status);
  END IF;
  IF t.status <> 'IN_TRANSIT' THEN RAISE EXCEPTION 'Ce transfert est déjà clôturé (%).', t.status USING ERRCODE = '22023'; END IF;

  IF NOT (public._tot_is_admin01() OR public._tot_is_depot_holder(t.dest_depot, 'receive')
          OR public.current_user_has_perm('perm_stock_receive_all')) THEN
    RAISE EXCEPTION 'Réception refusée : vous n''êtes pas responsable (réception) du dépôt « % ».', t.dest_depot USING ERRCODE = '42501';
  END IF;
  IF t.created_by = v_uid AND NOT public._tot_is_admin01() THEN
    RAISE EXCEPTION 'Séparation des tâches : l''expéditeur ne peut pas valider sa propre réception.' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NOT NULL THEN
    IF jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'p_items doit être un tableau JSON' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x
               WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.items) i WHERE i->>'product_id' = x->>'product_id')) THEN
      RAISE EXCEPTION 'p_items cite un article qui ne fait pas partie de ce transfert' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM set_config('app.stock_rpc', 'on', true);
  FOR it IN SELECT * FROM jsonb_array_elements(t.items) LOOP
    v_i := v_i + 1;
    v_pid := it->>'product_id'; v_ref := it->>'product_ref'; v_qty := (it->>'quantity')::numeric;
    v_rack := NULLIF(it->>'dest_rack', ''); v_price := COALESCE((it->>'unit_price')::numeric, 0);
    v_acc := true; v_reason := NULL; v_recv := v_qty; v_ov := NULL;
    IF p_items IS NOT NULL THEN
      SELECT x INTO v_ov FROM jsonb_array_elements(p_items) x WHERE x->>'product_id' = v_pid LIMIT 1;
      IF v_ov IS NOT NULL THEN
        v_acc := COALESCE((v_ov->>'accepted')::boolean, true);
        v_reason := NULLIF(trim(COALESCE(v_ov->>'reason','')), '');
        IF v_acc AND (v_ov ? 'quantity_received') THEN
          BEGIN v_recv := (v_ov->>'quantity_received')::numeric; EXCEPTION WHEN OTHERS THEN v_recv := NULL; END;
          IF v_recv IS NULL OR v_recv <= 0 OR v_recv > v_qty THEN
            RAISE EXCEPTION 'Quantité reçue invalide pour % : entre 1 et % (utilisez « Refuser » pour 0 ; un surplus doit faire l''objet d''un nouveau transfert)', v_ref, v_qty USING ERRCODE = '22023';
          END IF;
        END IF;
      END IF;
    END IF;
    IF NOT v_acc AND v_reason IS NULL THEN
      RAISE EXCEPTION 'Un motif est obligatoire pour refuser l''article %', v_ref USING ERRCODE = '22023';
    END IF;
    IF v_acc AND v_recv < v_qty AND v_reason IS NULL THEN
      RAISE EXCEPTION 'Un commentaire est obligatoire pour modifier la quantité de l''article %', v_ref USING ERRCODE = '22023';
    END IF;

    IF v_acc THEN
      IF v_recv < v_qty THEN v_n_mod := v_n_mod + 1; ELSE v_n_ok := v_n_ok + 1; END IF;
      INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, rack_location, updated_at)
      VALUES (v_pid, t.dest_depot, v_recv, v_rack, now())
      ON CONFLICT (product_id, depot_name) DO UPDATE
        SET quantity = public.stk_stock_levels.quantity + v_recv,
            rack_location = COALESCE(v_rack, public.stk_stock_levels.rack_location), updated_at = now();
      INSERT INTO public.stk_movements (id, product_id, product_ref, user_id, user_name, movement_type, quantity_changed,
          reason, site_number, department_name, total_cost, depot_name, dest_depot_name, created_at)
      VALUES ('MOV-' || t.id || '-IN-' || v_i, v_pid, v_ref, v_uid, v_name, 'IN', v_recv,
          format('Réception transfert %s depuis %s', t.id, t.source_depot), format('RÉCEPTION <- %s', t.source_depot),
          'Logistique', ROUND(v_recv * v_price, 2), t.dest_depot, NULL, now());
      SELECT COALESCE(SUM(quantity),0) INTO v_total FROM public.stk_stock_levels WHERE product_id = v_pid;
      UPDATE public.stk_products SET quantity = v_total, updated_at = now() WHERE id::text = v_pid;
      SELECT quantity INTO v_src_after FROM public.stk_stock_levels WHERE product_id = v_pid AND depot_name = t.source_depot;
      IF COALESCE(v_src_after, 0) = 0 THEN
        UPDATE public.stk_products SET store_name = t.dest_depot, shelf_name = COALESCE(v_rack, shelf_name) WHERE id::text = v_pid;
      END IF;
      v_new := v_new || jsonb_build_array(it || jsonb_build_object(
        'decision', CASE WHEN v_recv < v_qty THEN 'MODIFIED' ELSE 'ACCEPTED' END,
        'quantity_received', v_recv, 'quantity_returned', 0, 'quantity_pending', v_qty - v_recv, 'receiver_comment', v_reason));
      IF v_recv < v_qty THEN
        PERFORM public._tot_transfer_audit('STOCK_TRANSFER_LINE_MODIFIED', 'Quantité modifiée à la réception',
          format('Transfert %s : %s envoyé × %s, reçu × %s (%s → %s) par %s. Commentaire : %s', t.id, v_ref, v_qty, v_recv, t.source_depot, t.dest_depot, v_name, v_reason),
          'WARNING', jsonb_build_object('transfer_id', t.id, 'product_id', v_pid, 'product_ref', v_ref, 'sent', v_qty,
            'received', v_recv, 'comment', v_reason, 'sent_by', t.created_by_name), v_uid, v_name, t.dest_depot);
      END IF;
    ELSE
      v_n_ko := v_n_ko + 1;
      PERFORM public._tot_transfer_give_back(t.id, t.source_depot, v_pid, v_ref, v_qty,
        format('Article refusé à la réception (%s) : %s', t.id, v_reason), v_uid, v_name, t.dest_depot);
      v_new := v_new || jsonb_build_array(it || jsonb_build_object('decision', 'REFUSED', 'refusal_reason', v_reason,
        'quantity_received', 0, 'quantity_returned', v_qty, 'quantity_pending', 0));
      PERFORM public._tot_transfer_audit('STOCK_TRANSFER_LINE_REFUSED', 'Article refusé à la réception',
        format('Transfert %s : %s × %s refusé par %s (%s → %s). Motif : %s', t.id, v_ref, v_qty, v_name, t.source_depot, t.dest_depot, v_reason),
        'WARNING', jsonb_build_object('transfer_id', t.id, 'product_id', v_pid, 'product_ref', v_ref, 'quantity', v_qty,
          'reason', v_reason, 'sent_by', t.created_by_name), v_uid, v_name, t.dest_depot);
    END IF;
  END LOOP;

  v_status := CASE WHEN v_n_mod > 0 THEN 'AWAITING_SENDER'   -- l'expéditeur doit confirmer les modifications
                   WHEN v_n_ok = 0 THEN 'REJECTED'
                   WHEN v_n_ko > 0 THEN 'PARTIALLY_RECEIVED'
                   ELSE 'RECEIVED' END;
  UPDATE public.stk_transfers SET status = v_status, items = v_new, has_variance = (v_n_mod + v_n_ko > 0),
    resolved_by = v_uid, resolved_by_name = v_name, resolved_at = now(), resolution_note = left(p_note, 500)
  WHERE id = t.id;

  PERFORM public._tot_transfer_audit('STOCK_TRANSFER_' || v_status,
    CASE v_status WHEN 'RECEIVED' THEN 'Transfert reçu' WHEN 'PARTIALLY_RECEIVED' THEN 'Transfert reçu avec articles refusés'
      WHEN 'AWAITING_SENDER' THEN 'Transfert reçu avec modification de quantité : confirmation de l''expéditeur requise' ELSE 'Transfert refusé' END,
    format('%s : %s → %s, %s accepté(s), %s modifié(s), %s refusé(s), validé par %s', t.id, t.source_depot, t.dest_depot, v_n_ok, v_n_mod, v_n_ko, v_name),
    CASE WHEN v_n_mod + v_n_ko > 0 THEN 'WARNING' ELSE 'INFO' END,
    jsonb_build_object('transfer_id', t.id, 'accepted', v_n_ok, 'modified', v_n_mod, 'refused', v_n_ko, 'note', left(p_note, 500), 'items', v_new),
    v_uid, v_name, t.dest_depot);
  RETURN jsonb_build_object('success', true, 'transfer_id', t.id, 'status', v_status, 'accepted', v_n_ok, 'modified', v_n_mod,
    'refused', v_n_ko, 'sender_confirmation_required', (v_n_mod > 0), 'items', v_new);
END $$;

-- 9b. Statut final une fois les modifications réglées -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tot_transfer_final_status(p_items jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) i WHERE i->>'decision' <> 'REFUSED') THEN 'REJECTED'
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) i WHERE i->>'decision' = 'REFUSED') THEN 'PARTIALLY_RECEIVED'
    ELSE 'RECEIVED' END
$$;

-- 9c. L'expéditeur confirme (ou conteste) la modification de quantité, avec commentaire ------------------------------
-- p_confirm = true  : la quantité reçue est la bonne ; la différence retourne en stock à la source.
-- p_confirm = false : contestation (commentaire obligatoire) ; la logistique tranche (resolve_transfer_dispute).
CREATE OR REPLACE FUNCTION public.confirm_stock_transfer_adjustment(p_transfer_id text, p_confirm boolean, p_comment text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid text; v_name text; t public.stk_transfers; it jsonb; v_new jsonb := '[]'::jsonb; v_pend numeric; v_status text;
  v_comment text := NULLIF(trim(COALESCE(p_comment, '')), '');
BEGIN
  SELECT id::text, name INTO v_uid, v_name FROM public.core_users WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked,false) = false LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM public.stk_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfert introuvable' USING ERRCODE = 'P0002'; END IF;
  IF t.status NOT IN ('AWAITING_SENDER') THEN
    IF t.status IN ('RECEIVED','PARTIALLY_RECEIVED','DISPUTED') AND t.resolution_note ~ '(Confirmé|Contesté) par' THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'transfer_id', t.id, 'status', t.status);
    END IF;
    RAISE EXCEPTION 'Aucune confirmation attendue pour ce transfert (statut %).', t.status USING ERRCODE = '22023';
  END IF;
  IF NOT (public._tot_is_admin01() OR t.created_by = v_uid OR public._tot_is_depot_holder(t.source_depot, 'send')) THEN
    RAISE EXCEPTION 'Seul l''expéditeur (ou un responsable d''envoi du dépôt « % ») peut confirmer.', t.source_depot USING ERRCODE = '42501';
  END IF;
  IF v_uid = t.resolved_by AND NOT public._tot_is_admin01() THEN
    RAISE EXCEPTION 'Séparation des tâches : le receveur ne peut pas confirmer sa propre modification.' USING ERRCODE = '42501';
  END IF;
  IF NOT p_confirm AND v_comment IS NULL THEN
    RAISE EXCEPTION 'Un commentaire est obligatoire pour contester la modification' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.stock_rpc', 'on', true);
  IF p_confirm THEN
    FOR it IN SELECT * FROM jsonb_array_elements(t.items) LOOP
      v_pend := COALESCE((it->>'quantity_pending')::numeric, 0);
      IF v_pend > 0 THEN
        PERFORM public._tot_transfer_give_back(t.id, t.source_depot, it->>'product_id', it->>'product_ref', v_pend,
          format('Quantité modifiée à la réception %s, confirmée par l''expéditeur : retour à la source', t.id), v_uid, v_name, t.dest_depot);
        it := it || jsonb_build_object('quantity_returned', COALESCE((it->>'quantity_returned')::numeric,0) + v_pend, 'quantity_pending', 0);
      END IF;
      v_new := v_new || jsonb_build_array(it);
    END LOOP;
    v_status := public._tot_transfer_final_status(v_new);
    UPDATE public.stk_transfers SET status = v_status, items = v_new,
      resolution_note = left(COALESCE(resolution_note || ' | ', '') || 'Confirmé par ' || v_name || COALESCE(' : ' || v_comment, ''), 500)
    WHERE id = t.id;
  ELSE
    v_status := 'DISPUTED';
    UPDATE public.stk_transfers SET status = 'DISPUTED',
      resolution_note = left(COALESCE(resolution_note || ' | ', '') || 'Contesté par ' || v_name || ' : ' || v_comment, 500)
    WHERE id = t.id;
  END IF;

  PERFORM public._tot_transfer_audit(CASE WHEN p_confirm THEN 'STOCK_TRANSFER_ADJUSTMENT_CONFIRMED' ELSE 'STOCK_TRANSFER_DISPUTED' END,
    CASE WHEN p_confirm THEN 'Modification de quantité confirmée par l''expéditeur' ELSE 'Modification de quantité contestée par l''expéditeur' END,
    format('Transfert %s (%s → %s) : %s par %s%s', t.id, t.source_depot, t.dest_depot,
      CASE WHEN p_confirm THEN 'confirmé' ELSE 'contesté' END, v_name, COALESCE(' — ' || v_comment, '')),
    CASE WHEN p_confirm THEN 'INFO' ELSE 'WARNING' END,
    jsonb_build_object('transfer_id', t.id, 'comment', left(v_comment, 500), 'receiver', t.resolved_by_name, 'final_status', v_status), v_uid, v_name, t.source_depot);
  RETURN jsonb_build_object('success', true, 'transfer_id', t.id, 'status', v_status);
END $$;

-- 9d. Arbitrage de la logistique sur un transfert contesté -------------------------------------------------------------
-- p_action = 'RETURN_TO_SOURCE' (la différence retourne au dépôt source) ou 'WRITE_OFF' (la différence est enregistrée comme perte).
CREATE OR REPLACE FUNCTION public.resolve_transfer_dispute(p_transfer_id text, p_action text, p_comment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid text; v_name text; t public.stk_transfers; it jsonb; v_new jsonb := '[]'::jsonb; v_pend numeric; v_status text;
  v_comment text := NULLIF(trim(COALESCE(p_comment, '')), '');
BEGIN
  SELECT id::text, name INTO v_uid, v_name FROM public.core_users WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked,false) = false LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501'; END IF;
  IF NOT (public._tot_is_admin01() OR public.current_user_has_perm('perm_stock_receive_all')) THEN
    RAISE EXCEPTION 'Arbitrage réservé à la logistique' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('RETURN_TO_SOURCE','WRITE_OFF') THEN RAISE EXCEPTION 'Action invalide' USING ERRCODE = '22023'; END IF;
  IF v_comment IS NULL THEN RAISE EXCEPTION 'Un commentaire est obligatoire' USING ERRCODE = '22023'; END IF;
  SELECT * INTO t FROM public.stk_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfert introuvable' USING ERRCODE = 'P0002'; END IF;
  IF t.status <> 'DISPUTED' THEN RAISE EXCEPTION 'Ce transfert n''est pas en litige (statut %).', t.status USING ERRCODE = '22023'; END IF;

  PERFORM set_config('app.stock_rpc', 'on', true);
  FOR it IN SELECT * FROM jsonb_array_elements(t.items) LOOP
    v_pend := COALESCE((it->>'quantity_pending')::numeric, 0);
    IF v_pend > 0 THEN
      IF p_action = 'RETURN_TO_SOURCE' THEN
        PERFORM public._tot_transfer_give_back(t.id, t.source_depot, it->>'product_id', it->>'product_ref', v_pend,
          format('Litige %s tranché par la logistique : retour à la source', t.id), v_uid, v_name, t.dest_depot);
        it := it || jsonb_build_object('quantity_returned', COALESCE((it->>'quantity_returned')::numeric,0) + v_pend, 'quantity_pending', 0);
      ELSE
        it := it || jsonb_build_object('quantity_written_off', v_pend, 'quantity_pending', 0);
      END IF;
    END IF;
    v_new := v_new || jsonb_build_array(it);
  END LOOP;
  v_status := public._tot_transfer_final_status(v_new);
  UPDATE public.stk_transfers SET status = v_status, items = v_new,
    resolution_note = left(COALESCE(resolution_note || ' | ', '') || 'Arbitrage ' || p_action || ' par ' || v_name || ' : ' || v_comment, 500)
  WHERE id = t.id;
  PERFORM public._tot_transfer_audit('STOCK_TRANSFER_DISPUTE_RESOLVED', 'Litige de transfert tranché',
    format('Transfert %s : %s par %s — %s', t.id, p_action, v_name, v_comment), 'WARNING',
    jsonb_build_object('transfer_id', t.id, 'action', p_action, 'comment', left(v_comment, 500), 'final_status', v_status, 'items', v_new),
    v_uid, v_name, t.dest_depot);
  RETURN jsonb_build_object('success', true, 'transfer_id', t.id, 'status', v_status, 'action', p_action);
END $$;

-- 10. Refus et annulation : tout le stock retourne à la source ---------------------------------
CREATE OR REPLACE FUNCTION public._tot_transfer_close_back(p_transfer_id text, p_new_status text, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid text; v_name text; t public.stk_transfers; it jsonb; v_total numeric;
BEGIN
  SELECT id::text, name INTO v_uid, v_name FROM public.core_users WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked,false) = false LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM public.stk_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfert introuvable' USING ERRCODE = 'P0002'; END IF;
  IF t.status = p_new_status THEN RETURN jsonb_build_object('success', true, 'idempotent', true, 'transfer_id', t.id, 'status', t.status); END IF;
  IF t.status <> 'IN_TRANSIT' THEN RAISE EXCEPTION 'Ce transfert est déjà clôturé (%).', t.status USING ERRCODE = '22023'; END IF;

  IF p_new_status = 'REJECTED' THEN
    IF NOT (public._tot_is_admin01() OR public._tot_is_depot_holder(t.dest_depot, 'receive') OR public.current_user_has_perm('perm_stock_receive_all')) THEN
      RAISE EXCEPTION 'Refus impossible : vous n''êtes pas responsable (réception) de « % ».', t.dest_depot USING ERRCODE = '42501';
    END IF;
    IF NULLIF(trim(COALESCE(p_note,'')), '') IS NULL THEN RAISE EXCEPTION 'Un motif de refus est obligatoire' USING ERRCODE = '22023'; END IF;
  ELSE
    IF NOT (public._tot_is_admin01() OR t.created_by = v_uid) THEN
      RAISE EXCEPTION 'Seul l''expéditeur ou un administrateur peut annuler ce transfert' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(t.items) LOOP
    PERFORM public._tot_transfer_give_back(t.id, t.source_depot, it->>'product_id', it->>'product_ref', (it->>'quantity')::numeric,
      format('%s du transfert %s : retour à la source', CASE p_new_status WHEN 'REJECTED' THEN 'Refus' ELSE 'Annulation' END, t.id),
      v_uid, v_name, t.dest_depot);
  END LOOP;
  UPDATE public.stk_transfers SET status = p_new_status, resolved_by = v_uid, resolved_by_name = v_name,
    resolved_at = now(), resolution_note = left(p_note, 500) WHERE id = t.id;
  PERFORM public._tot_transfer_audit('STOCK_TRANSFER_' || p_new_status,
    CASE p_new_status WHEN 'REJECTED' THEN 'Transfert refusé en bloc' ELSE 'Transfert annulé' END,
    format('%s : %s → %s %s par %s%s', t.id, t.source_depot, t.dest_depot,
      CASE p_new_status WHEN 'REJECTED' THEN 'refusé' ELSE 'annulé' END, v_name,
      COALESCE(' — ' || NULLIF(trim(COALESCE(p_note,'')), ''), '')),
    CASE p_new_status WHEN 'REJECTED' THEN 'WARNING' ELSE 'INFO' END,
    jsonb_build_object('transfer_id', t.id, 'note', left(p_note, 500), 'items', t.items), v_uid, v_name, t.dest_depot);
  RETURN jsonb_build_object('success', true, 'transfer_id', t.id, 'status', p_new_status);
END $$;

CREATE OR REPLACE FUNCTION public.reject_stock_transfer(p_transfer_id text, p_note text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._tot_transfer_close_back(p_transfer_id, 'REJECTED', p_note) $$;
CREATE OR REPLACE FUNCTION public.cancel_stock_transfer(p_transfer_id text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._tot_transfer_close_back(p_transfer_id, 'CANCELLED', p_note) $$;

-- Transferts restés en transit trop longtemps (RLS appliquée)
CREATE OR REPLACE FUNCTION public.list_overdue_transfers(p_hours int DEFAULT 48)
RETURNS SETOF public.stk_transfers LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT * FROM public.stk_transfers WHERE status IN ('IN_TRANSIT','AWAITING_SENDER','DISPUTED') AND created_at < now() - make_interval(hours => GREATEST(p_hours, 1))
  ORDER BY created_at
$$;

-- 11. L'ancien transfert direct passe par le nouveau circuit (aucun contournement) ---------------
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  WHERE p.proname = 'transfer_stock_batch' AND p.pronamespace = 'public'::regnamespace
    AND pg_get_function_identity_arguments(p.oid) = 'p_batch_id uuid, p_source_depot text, p_dest_depot text, p_items jsonb, p_reason text';
  IF v_def IS NOT NULL AND position('TOT_TWO_STEP_WRAPPER' IN v_def) = 0 THEN
    DROP FUNCTION IF EXISTS public._tot_transfer_stock_batch_direct(uuid, text, text, jsonb, text);
    ALTER FUNCTION public.transfer_stock_batch(uuid, text, text, jsonb, text) RENAME TO _tot_transfer_stock_batch_direct;
    REVOKE ALL ON FUNCTION public._tot_transfer_stock_batch_direct(uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public._tot_transfer_stock_batch_direct(uuid, text, text, jsonb, text) TO service_role;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.transfer_stock_batch(
  p_batch_id uuid, p_source_depot text, p_dest_depot text, p_items jsonb, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- TOT_TWO_STEP_WRAPPER : tout transfert passe par l'envoi puis la validation de réception
  RETURN public.send_stock_transfer(p_batch_id, p_source_depot, p_dest_depot, p_items, p_reason);
END $$;

-- 12. Rapport de niveau de stock : réservé à la logistique -----------------------------------------
CREATE OR REPLACE FUNCTION public.get_stock_levels_report(p_depot text DEFAULT NULL, p_only_low boolean DEFAULT false)
RETURNS TABLE(depot_name text, product_id text, reference text, brand text, model text, quantity numeric, min_stock numeric, unit_price numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501'; END IF;
  IF NOT (public._tot_is_admin01() OR public.current_user_has_perm('perm_report_stock_levels')) THEN
    RAISE EXCEPTION 'Droit insuffisant : rapport de niveau de stock réservé à la logistique' USING ERRCODE = '42501';
  END IF;
  PERFORM public.log_audit_event('EXPORTS', 'stock_levels_report', 'Rapport de niveau de stock',
    COALESCE('Dépôt : ' || p_depot, 'Tous les dépôts'), jsonb_build_object('depot', p_depot, 'only_low', p_only_low));
  RETURN QUERY
    SELECT l.depot_name, l.product_id, p.reference, p.brand, p.model, l.quantity, COALESCE(l.min_stock, 0), p.unit_price
    FROM public.stk_stock_levels l JOIN public.stk_products p ON p.id::text = l.product_id
    WHERE (p_depot IS NULL OR l.depot_name = p_depot)
      AND (NOT p_only_low OR l.quantity <= COALESCE(l.min_stock, 0))
    ORDER BY l.depot_name, p.reference;
END $$;

-- 13. Droits d'exécution ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._tot_transfer_give_back(text,text,text,text,numeric,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._tot_transfer_close_back(text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._tot_transfer_audit(text,text,text,text,jsonb,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_depot_holders(text,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.send_stock_transfer(uuid,text,text,jsonb,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.receive_stock_transfer(text,jsonb,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirm_stock_transfer_adjustment(text,boolean,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolve_transfer_dispute(text,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_stock_transfer(text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_stock_transfer(text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transfer_stock_batch(uuid,text,text,jsonb,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_stock_levels_report(text,boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_overdue_transfers(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_depot_holders(text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_stock_transfer(uuid,text,text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_stock_transfer(text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_stock_transfer_adjustment(text,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_transfer_dispute(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_stock_transfer(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_stock_transfer(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_stock_batch(uuid,text,text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_overdue_transfers(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_levels_report(text,boolean) TO authenticated;
