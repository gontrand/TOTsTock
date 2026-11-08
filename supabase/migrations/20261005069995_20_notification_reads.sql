-- =========================================================================
-- FICHIER GÉNÉRÉ AUTOMATIQUEMENT PAR scripts/build-sql.mjs — NE PAS MODIFIER DIRECTEMENT
-- Source de vérité : supabase-client/20_notification_reads.sql
-- Étape 20 : Notifications lues par utilisateur (core_notification_dismissals, dismiss_notifications, clear_my_dismissals)
-- =========================================================================
-- =========================================================================
-- 20_notification_reads.sql  (schéma 2.10.0 — app 5.16.0)
-- Notifications « lues » PAR UTILISATEUR : chacun vide sa propre cloche, jamais celle des autres.
--  * core_notification_dismissals : (user_id, notif_key) ; notif_key = "<type>:<id commande/transfert>:<statut>"
--    -> un nouvel événement (autre statut) génère une nouvelle clé, donc une nouvelle notification.
--  * RLS : chaque utilisateur ne lit / n'écrit / ne supprime QUE ses lignes. anon : aucun droit.
--  * RPC dismiss_notifications(text[]) : marque une ou plusieurs notifications comme lues (idempotent, max 500 clés).
--  * RPC clear_my_dismissals() : ré-affiche toutes MES notifications encore actives.
--  * Purge automatique des lignes de plus de 90 jours.
-- user_id en TEXT sans clé étrangère (types d'id variables) ; nettoyage par trigger à la suppression d'un utilisateur.
-- Idempotent. Dépend du script 02 (current_user_id).
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.core_notification_dismissals (
  user_id      TEXT NOT NULL,
  notif_key    TEXT NOT NULL,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notif_key)
);
ALTER TABLE public.core_notification_dismissals ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_notif_dismissals_date ON public.core_notification_dismissals (dismissed_at);

ALTER TABLE public.core_notification_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.core_notification_dismissals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.core_notification_dismissals FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.core_notification_dismissals TO authenticated;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='core_notification_dismissals' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.core_notification_dismissals', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "Select own core_notification_dismissals" ON public.core_notification_dismissals
  FOR SELECT TO authenticated USING (public.current_user_id() IS NOT NULL AND user_id = public.current_user_id());
CREATE POLICY "Insert own core_notification_dismissals" ON public.core_notification_dismissals
  FOR INSERT TO authenticated WITH CHECK (public.current_user_id() IS NOT NULL AND user_id = public.current_user_id());
CREATE POLICY "Delete own core_notification_dismissals" ON public.core_notification_dismissals
  FOR DELETE TO authenticated USING (public.current_user_id() IS NOT NULL AND user_id = public.current_user_id());

CREATE OR REPLACE FUNCTION public.dismiss_notifications(p_keys text[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid text := public.current_user_id(); v_n int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501'; END IF;
  IF p_keys IS NULL OR array_length(p_keys, 1) IS NULL THEN RETURN 0; END IF;
  IF array_length(p_keys, 1) > 500 THEN RAISE EXCEPTION 'Trop de notifications (max 500)'; END IF;
  INSERT INTO public.core_notification_dismissals (user_id, notif_key)
    SELECT DISTINCT v_uid, left(k, 200) FROM unnest(p_keys) AS k WHERE k IS NOT NULL AND btrim(k) <> ''
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM public.core_notification_dismissals WHERE dismissed_at < now() - interval '90 days';
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.clear_my_dismissals() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid text := public.current_user_id(); v_n int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.core_notification_dismissals WHERE user_id = v_uid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public._tot_notif_dismissals_cleanup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN DELETE FROM public.core_notification_dismissals WHERE user_id = OLD.id::text; RETURN OLD; END $$;
REVOKE ALL ON FUNCTION public._tot_notif_dismissals_cleanup() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notif_dismissals_cleanup ON public.core_users;
CREATE TRIGGER trg_notif_dismissals_cleanup AFTER DELETE ON public.core_users
  FOR EACH ROW EXECUTE FUNCTION public._tot_notif_dismissals_cleanup();

REVOKE ALL ON FUNCTION public.dismiss_notifications(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_my_dismissals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_notifications(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_my_dismissals() TO authenticated;
