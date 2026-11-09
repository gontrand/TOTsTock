-- =========================================================================
-- 19_order_trace.sql  (schéma 2.9.0 — app 5.15.0)
-- Traçabilité des commandes : demandeur, préparateur, enleveur et retrait transféré.
--
--  * Déclencheur trg_order_trace sur stk_material_orders : écrit dans core_audit_logs (catégorie ORDERS)
--    ORDER_CREATED, ORDER_APPROVED, ORDER_ASSIGNED, ORDER_READY, ORDER_PICKUP_DELEGATED,
--    ORDER_PICKUP_DELEGATION_CANCELLED, ORDER_COLLECTED, ORDER_REJECTED, ORDER_CANCELLED.
--  * ORDER_COLLECTED contient demandeur, préparateur, enleveur (collected_by), pickup_transferred (true/false)
--    et le délégué, la présence de signature/photo (jamais leur contenu).
--  * RPC get_order_trace(p_order_id) : chronologie d'une commande pour la fiche « Traçabilité »
--    (visible par le demandeur, le préparateur, le délégué de retrait et les rôles 0/1/5/6).
--  * Ne bloque jamais l'opération métier (EXCEPTION -> WARNING).
-- Idempotent : peut être relancé sans risque.
-- =========================================================================

-- Aides d'audit (acteur courant + IP) : définies ici pour que le script 19 soit autonome.
DROP FUNCTION IF EXISTS public._tot_order_actor() CASCADE;
CREATE OR REPLACE FUNCTION public._tot_order_actor()
RETURNS TABLE(a_id text, a_name text, a_trigram text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id::text, u.name::text, u.trigram::text
  FROM public.core_users u
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._tot_order_ip()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_h text;
BEGIN
  BEGIN
    v_h := current_setting('request.headers', true)::json ->> 'x-forwarded-for';
  EXCEPTION WHEN OTHERS THEN
    v_h := NULL;
  END;
  RETURN NULLIF(btrim(split_part(COALESCE(v_h, ''), ',', 1)), '');
END $$;

CREATE OR REPLACE FUNCTION public._tot_order_trace_emit(
  p_type text, p_severity text, p_title text, p_description text,
  p_order_id text, p_order_number text, p_site text, p_depot text, p_details jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor record;
BEGIN
  SELECT * INTO v_actor FROM public._tot_order_actor();
  INSERT INTO public.core_audit_logs
    (id, app, type, category, user_id, user_name, user_trigram, site_number, depot_name,
     title, description, meta, action, severity, details, ip_address, created_at)
  VALUES (
    'AUD-' || replace(gen_random_uuid()::text, '-', ''), 'stock', p_type, 'ORDERS',
    v_actor.a_id, v_actor.a_name, v_actor.a_trigram, p_site, p_depot,
    p_title, p_description,
    jsonb_build_object('entity', 'Commande', 'table', 'stk_material_orders', 'entity_id', p_order_id,
                       'label', p_order_number) || coalesce(p_details, '{}'::jsonb),
    p_type, p_severity,
    jsonb_build_object('order_id', p_order_id, 'order_number', p_order_number) || coalesce(p_details, '{}'::jsonb),
    public._tot_order_ip(), now());
END $$;

CREATE OR REPLACE FUNCTION public._tot_order_trace() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor record;
  v_base jsonb;
  v_has_delegate boolean;
  v_transferred boolean;
BEGIN
  BEGIN
    SELECT * INTO v_actor FROM public._tot_order_actor();
    v_has_delegate := NEW.pickup_delegate_id IS NOT NULL AND btrim(NEW.pickup_delegate_id::text) <> '';
    v_base := jsonb_build_object(
      'requester_id', NEW.requester_id, 'requester_name', NEW.requester_name,
      'requester_department', NEW.requester_department,
      'preparer_id', NEW.preparer_id, 'preparer_name', NEW.preparer_name,
      'status', NEW.status);

    IF TG_OP = 'INSERT' THEN
      PERFORM public._tot_order_trace_emit(
        'ORDER_CREATED', 'INFO', 'Commande créée',
        format('Commande %s créée par %s (demandeur : %s)', NEW.order_number, coalesce(v_actor.a_name, '?'), coalesce(NEW.requester_name, '?')),
        NEW.id::text, NEW.order_number, NEW.site_number, NEW.depot_name,
        v_base || jsonb_build_object('items_count', CASE WHEN jsonb_typeof(NEW.items) = 'array' THEN jsonb_array_length(NEW.items) END,
                                     'total_cost', NEW.total_cost));
      RETURN NEW;
    END IF;

    -- Validation hiérarchique
    IF OLD.status = 'WAITING_APPROVAL' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('PENDING','PREPARING') THEN
      PERFORM public._tot_order_trace_emit(
        'ORDER_APPROVED', 'INFO', 'Commande validée',
        format('Commande %s validée par %s', NEW.order_number, coalesce(NEW.approved_by, v_actor.a_name, '?')),
        NEW.id::text, NEW.order_number, NEW.site_number, NEW.depot_name,
        v_base || jsonb_build_object('approved_by', NEW.approved_by));
    END IF;

    -- Assignation / changement de préparateur
    IF NEW.preparer_id IS NOT NULL AND NEW.preparer_id IS DISTINCT FROM OLD.preparer_id THEN
      PERFORM public._tot_order_trace_emit(
        'ORDER_ASSIGNED', 'INFO', 'Commande assignée à un préparateur',
        format('Commande %s prise en charge par le préparateur %s (demandeur : %s)', NEW.order_number, coalesce(NEW.preparer_name, '?'), coalesce(NEW.requester_name, '?')),
        NEW.id::text, NEW.order_number, NEW.site_number, NEW.depot_name,
        v_base || jsonb_build_object('previous_preparer_id', OLD.preparer_id, 'previous_preparer_name', OLD.preparer_name));
    END IF;

    -- Prête au retrait
    IF NEW.status = 'READY' AND OLD.status IS DISTINCT FROM 'READY' THEN
      PERFORM public._tot_order_trace_emit(
        'ORDER_READY', 'INFO', 'Commande prête au retrait',
        format('Commande %s prête au retrait (préparateur : %s, demandeur : %s)%s', NEW.order_number,
               coalesce(NEW.preparer_name, '?'), coalesce(NEW.requester_name, '?'),
               CASE WHEN NEW.pickup_zone IS NOT NULL AND NEW.pickup_zone <> '' THEN ', zone : ' || NEW.pickup_zone ELSE '' END),
        NEW.id::text, NEW.order_number, NEW.site_number, NEW.depot_name,
        v_base || jsonb_build_object('pickup_zone', NEW.pickup_zone, 'ready_at', NEW.ready_at));
    END IF;

    -- Retrait transféré à un collègue (ou transfert annulé)
    IF NEW.pickup_delegate_id IS DISTINCT FROM OLD.pickup_delegate_id THEN
      IF v_has_delegate THEN
        PERFORM public._tot_order_trace_emit(
          'ORDER_PICKUP_DELEGATED', 'INFO', 'Retrait transféré à un collègue',
          format('Retrait de la commande %s transféré de %s à %s%s', NEW.order_number,
                 coalesce(NEW.requester_name, '?'), coalesce(NEW.pickup_delegate_name, '?'),
                 CASE WHEN NEW.pickup_delegate_notes IS NOT NULL AND NEW.pickup_delegate_notes <> '' THEN ' — ' || NEW.pickup_delegate_notes ELSE '' END),
          NEW.id::text, NEW.order_number, NEW.site_number, NEW.depot_name,
          v_base || jsonb_build_object('pickup_transferred', true,
            'delegate_id', NEW.pickup_delegate_id, 'delegate_name', NEW.pickup_delegate_name,
            'delegate_department', NEW.pickup_delegate_department,
            'delegated_by', coalesce(NEW.pickup_delegate_by, v_actor.a_name),
            'delegated_at', NEW.pickup_delegate_at, 'note', NEW.pickup_delegate_notes));
      ELSE
        PERFORM public._tot_order_trace_emit(
          'ORDER_PICKUP_DELEGATION_CANCELLED', 'INFO', 'Transfert de retrait annulé',
          format('Le transfert de retrait de la commande %s vers %s a été annulé : le demandeur %s retire lui-même', NEW.order_number,
                 coalesce(OLD.pickup_delegate_name, '?'), coalesce(NEW.requester_name, '?')),
          NEW.id::text, NEW.order_number, NEW.site_number, NEW.depot_name,
          v_base || jsonb_build_object('pickup_transferred', false,
            'previous_delegate_id', OLD.pickup_delegate_id, 'previous_delegate_name', OLD.pickup_delegate_name));
      END IF;
    END IF;

    -- Retrait effectué : demandeur, préparateur, enleveur, transféré oui/non
    IF NEW.status = 'COLLECTED' AND OLD.status IS DISTINCT FROM 'COLLECTED' THEN
      v_transferred := v_has_delegate;
      PERFORM public._tot_order_trace_emit(
        'ORDER_COLLECTED', 'INFO', 'Commande retirée',
        format('Commande %s retirée par %s — demandeur : %s, préparateur : %s — retrait transféré : %s%s', NEW.order_number,
               coalesce(NEW.collected_by, '?'), coalesce(NEW.requester_name, '?'), coalesce(NEW.preparer_name, '?'),
               CASE WHEN v_transferred THEN 'oui' ELSE 'non' END,
               CASE WHEN v_transferred THEN ' (délégué : ' || coalesce(NEW.pickup_delegate_name, '?') || ')' ELSE '' END),
        NEW.id::text, NEW.order_number, NEW.site_number, NEW.depot_name,
        v_base || jsonb_build_object(
          'collected_by', NEW.collected_by, 'collected_at', NEW.collected_at,
          'pickup_transferred', v_transferred,
          'delegate_id', NEW.pickup_delegate_id, 'delegate_name', NEW.pickup_delegate_name,
          'has_signature', coalesce(NEW.signature_data, '') <> '',
          'has_photo', coalesce(NEW.proof_photo_url, '') <> ''));
    END IF;

    -- Refus / annulation
    IF NEW.status = 'REJECTED' AND OLD.status IS DISTINCT FROM 'REJECTED' THEN
      PERFORM public._tot_order_trace_emit(
        'ORDER_REJECTED', 'WARNING', 'Commande refusée',
        format('Commande %s refusée par %s%s', NEW.order_number, coalesce(NEW.rejected_by, v_actor.a_name, '?'),
               CASE WHEN NEW.rejection_reason IS NOT NULL AND NEW.rejection_reason <> '' THEN ' — motif : ' || NEW.rejection_reason ELSE '' END),
        NEW.id::text, NEW.order_number, NEW.site_number, NEW.depot_name,
        v_base || jsonb_build_object('rejected_by', NEW.rejected_by, 'reason', NEW.rejection_reason));
    END IF;
    IF NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED' THEN
      PERFORM public._tot_order_trace_emit(
        'ORDER_CANCELLED', 'WARNING', 'Commande annulée',
        format('Commande %s annulée par %s (demandeur : %s)', NEW.order_number, coalesce(v_actor.a_name, '?'), coalesce(NEW.requester_name, '?')),
        NEW.id::text, NEW.order_number, NEW.site_number, NEW.depot_name, v_base);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'traçabilité commande non enregistrée (%): %', NEW.id, SQLERRM;  -- ne bloque jamais l'opération métier
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_order_trace ON public.stk_material_orders;
CREATE TRIGGER trg_order_trace
  AFTER INSERT OR UPDATE ON public.stk_material_orders
  FOR EACH ROW EXECUTE FUNCTION public._tot_order_trace();

-- -------------------------------------------------------------------------
-- get_order_trace : chronologie d'une commande (fiche « Traçabilité »).
-- Visible par le demandeur, le préparateur, le délégué de retrait et les rôles 0 / 1 / 5 / 6.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_order_trace(p_order_id text)
RETURNS TABLE(created_at timestamptz, type text, title text, description text, user_name text, details jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid text := public.current_user_id()::text;
  v_role int := public.current_user_role();
  o record;
BEGIN
  SELECT m.requester_id::text AS requester_id, m.preparer_id::text AS preparer_id,
         m.pickup_delegate_id::text AS delegate_id
    INTO o FROM public.stk_material_orders m WHERE m.id::text = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_uid IS NULL THEN RETURN; END IF;
  IF NOT coalesce(
       coalesce(v_role IN (0, 1, 5, 6), false)
       OR coalesce(v_uid = o.requester_id, false)
       OR coalesce(v_uid = o.preparer_id, false)
       OR coalesce(v_uid = o.delegate_id, false), false) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT l.created_at, l.type, l.title, l.description, l.user_name, l.details
      FROM public.core_audit_logs l
     WHERE l.category = 'ORDERS' AND l.details ->> 'order_id' = p_order_id
     ORDER BY l.created_at ASC, l.id ASC;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_order_trace(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_order_trace(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public._tot_order_trace_emit(text,text,text,text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
