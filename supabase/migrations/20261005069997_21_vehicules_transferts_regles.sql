-- =========================================================================
-- FICHIER GÉNÉRÉ AUTOMATIQUEMENT PAR scripts/build-sql.mjs — NE PAS MODIFIER DIRECTEMENT
-- Source de vérité : supabase-client/21_vehicules_transferts_regles.sql
-- Étape 21 : Visibilité véhicules/conteneurs par département, cohérence attribution, retour des transferts de plus de 7 jours
-- =========================================================================
-- =========================================================================
-- TOT STOCK - SCRIPT 21 : RÈGLES VÉHICULES / CONTENEURS ET TRANSFERTS > 7 JOURS
-- (21_vehicules_transferts_regles.sql)
-- -------------------------------------------------------------------------
-- 1. Visibilité d'un camion / conteneur (dépôt de type VEHICLE ou CONTAINER) :
--    seuls peuvent le consulter
--      - le responsable (chauffeur) et son binôme,
--      - le responsable du département et ses suppléants,
--      - les conducteurs de travaux / gestionnaires de projet (et suppléants)
--        des projets rattachés au département du véhicule (ou au chantier du conteneur),
--      - les administrateurs (rôles 0 et 1).
--    Appliqué côté base sur stk_depots et stk_stock_levels (lecture).
-- 2. Un camion / conteneur attribué à une personne appartient au département de
--    cette personne : département renseigné automatiquement s'il est vide,
--    refus si le département saisi diffère de celui du responsable.
-- 3. Transfert non validé depuis plus de 7 jours : l'émetteur doit le remettre
--    dans le stock du dépôt source avec un commentaire obligatoire
--      - trigger : l'annulation d'un transfert de plus de 7 jours exige un commentaire,
--      - RPC public.list_transfers_to_return(p_days INT DEFAULT 7) : transferts à remettre en stock,
--      - RPC public.return_overdue_transfer(id, commentaire).
-- 4. Retrait d'une commande : seul le demandeur (émetteur) ou son délégué de retrait peut
--    valider le retrait (statut COLLECTED), avec une signature obligatoire.
-- 5. Projets (chantiers) en cours / terminés : colonne status sur core_projects,
--    RPC public.close_project / public.reopen_project, et blocage des sorties de matériel
--    et des commandes sur un projet terminé (les entrées / retours restent possibles).
-- Ordre d'exécution : 21 (après 20_notification_reads.sql, avant 07_app_compat.sql)
-- Rejouable / Idempotent : oui
-- =========================================================================

DO $$
BEGIN
  IF to_regclass('public.stk_depots') IS NULL THEN
    RAISE EXCEPTION 'Prérequis manquant (21_vehicules_transferts_regles.sql) : table public.stk_depots absente. Exécutez d''abord 02 et 04.';
  END IF;
  IF to_regclass('public.stk_stock_levels') IS NULL THEN
    RAISE EXCEPTION 'Prérequis manquant (21_vehicules_transferts_regles.sql) : table public.stk_stock_levels absente. Exécutez d''abord 02 et 04.';
  END IF;
  IF to_regclass('public.stk_transfers') IS NULL THEN
    RAISE EXCEPTION 'Prérequis manquant (21_vehicules_transferts_regles.sql) : table public.stk_transfers absente. Exécutez d''abord 17.';
  END IF;
  IF to_regprocedure('public.cancel_stock_transfer(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Prérequis manquant (21_vehicules_transferts_regles.sql) : fonction public.cancel_stock_transfer absente. Exécutez d''abord 17.';
  END IF;
  IF to_regprocedure('public.is_administrator()') IS NULL OR to_regprocedure('public.current_user_id()') IS NULL THEN
    RAISE EXCEPTION 'Prérequis manquant (21_vehicules_transferts_regles.sql) : fonctions de sécurité absentes. Exécutez d''abord 02.';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 1. FONCTION public.can_view_vehicle_or_container
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.can_view_vehicle_or_container(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.can_view_vehicle_or_container(
  p_type TEXT,
  p_manager_id TEXT,
  p_binome_ids JSONB,
  p_department_id TEXT,
  p_department_name TEXT,
  p_project_number TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid TEXT;
BEGIN
  -- Dépôt fixe : règle inchangée (visible par tout utilisateur connecté)
  IF UPPER(COALESCE(p_type, 'FIXED')) NOT IN ('VEHICLE', 'CONTAINER') THEN
    RETURN TRUE;
  END IF;

  v_uid := public.current_user_id();
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  IF public.is_administrator() THEN
    RETURN TRUE;
  END IF;

  -- Responsable (chauffeur)
  IF p_manager_id IS NOT NULL AND p_manager_id = v_uid THEN
    RETURN TRUE;
  END IF;

  -- Binôme
  IF p_binome_ids IS NOT NULL
     AND jsonb_typeof(p_binome_ids) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_binome_ids) b(v) WHERE b.v = v_uid) THEN
    RETURN TRUE;
  END IF;

  -- Responsable du département (ou suppléant)
  IF EXISTS (
    SELECT 1
    FROM public.core_departments d
    WHERE (
            (p_department_id IS NOT NULL AND d.id::text = p_department_id)
         OR (p_department_name IS NOT NULL AND LOWER(TRIM(d.name)) = LOWER(TRIM(p_department_name)))
          )
      AND (
            d.manager_id::text = v_uid
         OR v_uid = ANY(COALESCE(d.deputy_manager_ids, '{}'::text[]))
          )
  ) THEN
    RETURN TRUE;
  END IF;

  -- Gestionnaires de projet (et suppléants) des projets du département
  IF EXISTS (
    SELECT 1
    FROM public.core_projects pr
    JOIN public.core_departments d ON d.id = pr.department_id
    WHERE (
            (p_department_id IS NOT NULL AND d.id::text = p_department_id)
         OR (p_department_name IS NOT NULL AND LOWER(TRIM(d.name)) = LOWER(TRIM(p_department_name)))
          )
      AND (
            pr.manager_id::text = v_uid
         OR v_uid = ANY(COALESCE(pr.deputy_manager_ids, '{}'::text[]))
          )
  ) THEN
    RETURN TRUE;
  END IF;

  -- Conteneur : conducteur de travaux (et suppléants) du chantier rattaché
  IF UPPER(COALESCE(p_type, '')) = 'CONTAINER' AND p_project_number IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.core_projects pr
    WHERE pr.project_number::text = p_project_number
      AND (
            pr.manager_id::text = v_uid
         OR v_uid = ANY(COALESCE(pr.deputy_manager_ids, '{}'::text[]))
          )
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.can_view_vehicle_or_container(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_vehicle_or_container(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 2. POLITIQUES DE LECTURE stk_depots / stk_stock_levels
--    (les anciennes politiques « ALL » laissaient lire les véhicules à tout
--     détenteur de perm_prod_edit, perm_manage_depots... : elles sont scindées)
-- -------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  -- stk_depots
  ALTER TABLE public.stk_depots ENABLE ROW LEVEL SECURITY;
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stk_depots'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.stk_depots', r.policyname);
  END LOOP;

  CREATE POLICY "depots_select_visible" ON public.stk_depots
    FOR SELECT TO authenticated
    USING (
      public.current_user_id() IS NOT NULL
      AND public.can_view_vehicle_or_container(
            type::text, manager_id::text, to_jsonb(binome_ids), department_id::text, department_name::text, project_number::text)
    );
  CREATE POLICY "depots_insert_admin" ON public.stk_depots
    FOR INSERT TO authenticated
    WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_depots') OR public.current_user_has_perm('perm_depot_create'));
  CREATE POLICY "depots_update_admin" ON public.stk_depots
    FOR UPDATE TO authenticated
    USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_depots') OR public.current_user_has_perm('perm_depot_create'))
    WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_depots') OR public.current_user_has_perm('perm_depot_create'));
  CREATE POLICY "depots_delete_admin" ON public.stk_depots
    FOR DELETE TO authenticated
    USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_manage_depots') OR public.current_user_has_perm('perm_depot_create'));

  -- stk_stock_levels
  ALTER TABLE public.stk_stock_levels ENABLE ROW LEVEL SECURITY;
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stk_stock_levels'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.stk_stock_levels', r.policyname);
  END LOOP;

  CREATE POLICY "stock_levels_select_visible" ON public.stk_stock_levels
    FOR SELECT TO authenticated
    USING (
      public.is_administrator()
      OR EXISTS (
        SELECT 1 FROM public.stk_depots d
        WHERE d.name::text = stk_stock_levels.depot_name::text
          AND public.can_view_vehicle_or_container(
                d.type::text, d.manager_id::text, to_jsonb(d.binome_ids), d.department_id::text, d.department_name::text, d.project_number::text)
      )
    );
  CREATE POLICY "stock_levels_insert_admin" ON public.stk_stock_levels
    FOR INSERT TO authenticated
    WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_menu_inventory_audit') OR public.current_user_has_perm('perm_prod_edit'));
  CREATE POLICY "stock_levels_update_admin" ON public.stk_stock_levels
    FOR UPDATE TO authenticated
    USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_menu_inventory_audit') OR public.current_user_has_perm('perm_prod_edit'))
    WITH CHECK (public.current_user_role() = 0 OR public.current_user_has_perm('perm_menu_inventory_audit') OR public.current_user_has_perm('perm_prod_edit'));
  CREATE POLICY "stock_levels_delete_admin" ON public.stk_stock_levels
    FOR DELETE TO authenticated
    USING (public.current_user_role() = 0 OR public.current_user_has_perm('perm_menu_inventory_audit') OR public.current_user_has_perm('perm_prod_edit'));
END $$;

-- -------------------------------------------------------------------------
-- 3. COHÉRENCE ATTRIBUTION VÉHICULE / CONTENEUR ↔ DÉPARTEMENT
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.enforce_vehicle_department_consistency() CASCADE;
CREATE OR REPLACE FUNCTION public.enforce_vehicle_department_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_dept TEXT;
  v_dept_id TEXT;
  v_dept_name TEXT;
BEGIN
  IF UPPER(COALESCE(NEW.type::text, 'FIXED')) NOT IN ('VEHICLE', 'CONTAINER') THEN
    RETURN NEW;
  END IF;
  IF NEW.manager_id IS NULL OR TRIM(NEW.manager_id::text) = '' THEN
    RETURN NEW;
  END IF;

  SELECT NULLIF(TRIM(u.department), '') INTO v_user_dept
  FROM public.core_users u
  WHERE u.id::text = NEW.manager_id::text
  LIMIT 1;

  IF v_user_dept IS NULL THEN
    RETURN NEW; -- responsable sans département : rien à imposer
  END IF;

  SELECT d.id::text, d.name INTO v_dept_id, v_dept_name
  FROM public.core_departments d
  WHERE LOWER(TRIM(d.name)) = LOWER(v_user_dept)
  LIMIT 1;

  IF v_dept_id IS NULL THEN
    RETURN NEW; -- département du responsable absent de core_departments
  END IF;

  IF (NEW.department_id IS NULL OR TRIM(NEW.department_id::text) = '')
     AND (NEW.department_name IS NULL OR TRIM(NEW.department_name::text) = '') THEN
    NEW.department_id := v_dept_id;
    NEW.department_name := v_dept_name;
    RETURN NEW;
  END IF;

  IF NOT (
       (NEW.department_id IS NOT NULL AND NEW.department_id::text = v_dept_id)
    OR (NEW.department_name IS NOT NULL AND LOWER(TRIM(NEW.department_name::text)) = LOWER(v_dept_name))
  ) THEN
    RAISE EXCEPTION 'Un véhicule ou conteneur attribué à une personne doit appartenir au département de cette personne (%).', v_dept_name
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_vehicle_department_consistency() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_vehicle_department_consistency ON public.stk_depots;
CREATE TRIGGER trg_vehicle_department_consistency
  BEFORE INSERT OR UPDATE OF manager_id, department_id, department_name, type ON public.stk_depots
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_vehicle_department_consistency();

-- -------------------------------------------------------------------------
-- 4. TRANSFERTS NON VALIDÉS DEPUIS PLUS DE 7 JOURS
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.enforce_overdue_transfer_return_comment() CASCADE;
CREATE OR REPLACE FUNCTION public.enforce_overdue_transfer_return_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'IN_TRANSIT'
     AND NEW.status = 'CANCELLED'
     AND OLD.created_at <= (now() - INTERVAL '7 days')
     AND LENGTH(TRIM(COALESCE(NEW.resolution_note, ''))) < 5 THEN
    RAISE EXCEPTION 'Un transfert non validé depuis plus de 7 jours ne peut être remis en stock qu''avec un commentaire obligatoire (5 caractères minimum).'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_overdue_transfer_return_comment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_overdue_transfer_return_comment ON public.stk_transfers;
CREATE TRIGGER trg_overdue_transfer_return_comment
  BEFORE UPDATE OF status ON public.stk_transfers
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_overdue_transfer_return_comment();

DROP FUNCTION IF EXISTS public.list_transfers_to_return() CASCADE;
DROP FUNCTION IF EXISTS public.list_transfers_to_return(INT) CASCADE;
CREATE OR REPLACE FUNCTION public.list_transfers_to_return(p_days INT DEFAULT 7)
RETURNS SETOF public.stk_transfers
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid TEXT;
BEGIN
  IF current_user = 'anon' OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'anon' THEN
    RAISE EXCEPTION 'Accès refusé : rôle anonyme interdit.' USING ERRCODE = '42501';
  END IF;
  v_uid := public.current_user_id();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT t.*
  FROM public.stk_transfers t
  WHERE t.status = 'IN_TRANSIT'
    AND t.created_at <= (now() - make_interval(days => GREATEST(COALESCE(p_days, 7), 1)))
    AND (t.sender_id = v_uid OR public.is_administrator())
  ORDER BY t.created_at ASC;
END;
$$;

DROP FUNCTION IF EXISTS public.return_overdue_transfer(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.return_overdue_transfer(
  p_transfer_id TEXT,
  p_comment TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid TEXT;
  v_trf public.stk_transfers%ROWTYPE;
  v_comment TEXT := TRIM(COALESCE(p_comment, ''));
BEGIN
  IF current_user = 'anon' OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'anon' THEN
    RAISE EXCEPTION 'Accès refusé : rôle anonyme interdit.' USING ERRCODE = '42501';
  END IF;
  v_uid := public.current_user_id();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF LENGTH(v_comment) < 5 THEN
    RAISE EXCEPTION 'Un commentaire est obligatoire (5 caractères minimum) pour remettre le transfert en stock.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_trf
  FROM public.stk_transfers
  WHERE id = TRIM(COALESCE(p_transfer_id, '')) OR transfer_number = TRIM(COALESCE(p_transfer_id, ''))
  LIMIT 1;

  IF v_trf.id IS NULL THEN
    RAISE EXCEPTION 'Transfert introuvable (%).', COALESCE(p_transfer_id, 'NULL') USING ERRCODE = 'P0002';
  END IF;
  IF v_trf.status <> 'IN_TRANSIT' THEN
    RAISE EXCEPTION 'Seul un transfert en transit peut être remis en stock (statut actuel : %).', v_trf.status USING ERRCODE = '22023';
  END IF;
  IF v_trf.created_at > (now() - INTERVAL '7 days') THEN
    RAISE EXCEPTION 'Ce transfert a moins de 7 jours : utilisez l''annulation classique.' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_trf.sender_id = v_uid OR public.is_administrator()) THEN
    RAISE EXCEPTION 'Accès refusé : seul l''émetteur du transfert (ou un administrateur) peut le remettre en stock.' USING ERRCODE = '42501';
  END IF;

  RETURN public.cancel_stock_transfer(v_trf.id, v_comment);
END;
$$;

REVOKE ALL ON FUNCTION public.list_transfers_to_return(INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.return_overdue_transfer(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_transfers_to_return(INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.return_overdue_transfer(TEXT, TEXT) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 5. RETRAIT D'UNE COMMANDE : DEMANDEUR OU DÉLÉGUÉ + SIGNATURE OBLIGATOIRE
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.enforce_order_pickup_rules() CASCADE;
CREATE OR REPLACE FUNCTION public.enforce_order_pickup_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid TEXT;
BEGIN
  IF NEW.status = 'COLLECTED' AND OLD.status IS DISTINCT FROM 'COLLECTED' THEN
    v_uid := public.current_user_id();

    -- Contexte utilisateur connecté : seul le demandeur ou son délégué de retrait peut valider
    IF v_uid IS NOT NULL THEN
      IF NOT (
        NEW.requester_id::text = v_uid
        OR (NEW.pickup_delegate_id IS NOT NULL AND NEW.pickup_delegate_id::text = v_uid)
      ) THEN
        RAISE EXCEPTION 'Seul le demandeur de la commande ou son délégué de retrait peut valider le retrait.'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    IF LENGTH(TRIM(COALESCE(NEW.signature_data, ''))) < 50 THEN
      RAISE EXCEPTION 'La signature est obligatoire pour valider le retrait d''une commande.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_order_pickup_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_order_pickup_rules ON public.stk_material_orders;
CREATE TRIGGER trg_order_pickup_rules
  BEFORE UPDATE OF status ON public.stk_material_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_order_pickup_rules();

-- -------------------------------------------------------------------------
-- 6. PROJETS EN COURS / TERMINÉS
-- -------------------------------------------------------------------------
ALTER TABLE public.core_projects
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by TEXT,
  ADD COLUMN IF NOT EXISTS closed_by_name TEXT,
  ADD COLUMN IF NOT EXISTS close_note TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'core_projects' AND c.conname = 'chk_core_projects_status'
  ) THEN
    ALTER TABLE public.core_projects
      ADD CONSTRAINT chk_core_projects_status CHECK (status IN ('IN_PROGRESS', 'CLOSED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_core_projects_status ON public.core_projects(status);

-- Le statut ne peut changer que par les RPC close_project / reopen_project
DROP FUNCTION IF EXISTS public.enforce_project_status_via_rpc() CASCADE;
CREATE OR REPLACE FUNCTION public.enforce_project_status_via_rpc()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND COALESCE(current_setting('app.project_rpc', true), '') <> 'on'
     AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Le statut d''un projet se modifie uniquement avec « Terminer le projet » / « Rouvrir le projet ».'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_project_status_via_rpc() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_project_status_via_rpc ON public.core_projects;
CREATE TRIGGER trg_project_status_via_rpc
  BEFORE UPDATE OF status ON public.core_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_project_status_via_rpc();

CREATE OR REPLACE FUNCTION public._tot_can_manage_project(p_project_number TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid TEXT := public.current_user_id();
BEGIN
  IF v_uid IS NULL THEN RETURN FALSE; END IF;
  IF public.is_administrator() THEN RETURN TRUE; END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.core_projects p
    LEFT JOIN public.core_departments d ON d.id = p.department_id
    WHERE p.project_number = p_project_number
      AND (
        p.manager_id::text = v_uid
        OR v_uid = ANY(COALESCE(p.deputy_manager_ids, '{}'::text[]))
        OR d.manager_id::text = v_uid
        OR v_uid = ANY(COALESCE(d.deputy_manager_ids, '{}'::text[]))
      )
  );
END;
$$;
REVOKE ALL ON FUNCTION public._tot_can_manage_project(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._tot_can_manage_project(TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.close_project(p_project_number TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid TEXT;
  v_name TEXT;
  v_trigram TEXT;
  v_proj public.core_projects%ROWTYPE;
  v_open_orders INT;
BEGIN
  IF current_user = 'anon' OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'anon' THEN
    RAISE EXCEPTION 'Accès refusé : rôle anonyme interdit.' USING ERRCODE = '42501';
  END IF;
  v_uid := public.current_user_id();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;
  SELECT name, trigram INTO v_name, v_trigram FROM public.core_users WHERE id::text = v_uid LIMIT 1;

  SELECT * INTO v_proj FROM public.core_projects WHERE project_number = TRIM(COALESCE(p_project_number, '')) FOR UPDATE;
  IF v_proj.id IS NULL THEN
    RAISE EXCEPTION 'Projet introuvable (%).', COALESCE(p_project_number, 'NULL') USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._tot_can_manage_project(v_proj.project_number) THEN
    RAISE EXCEPTION 'Accès refusé : seuls un administrateur, le responsable du département ou le gestionnaire du projet (et suppléants) peuvent terminer ce projet.' USING ERRCODE = '42501';
  END IF;
  IF v_proj.status = 'CLOSED' THEN
    RAISE EXCEPTION 'Le projet % est déjà terminé.', v_proj.project_number USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_open_orders
  FROM public.stk_material_orders o
  WHERE o.site_number = v_proj.project_number
    AND o.status IN ('WAITING_APPROVAL', 'PENDING', 'PREPARING', 'READY');
  IF v_open_orders > 0 THEN
    RAISE EXCEPTION 'Impossible de terminer le projet % : % commande(s) encore en cours (à retirer ou annuler d''abord).', v_proj.project_number, v_open_orders
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.project_rpc', 'on', true);
  UPDATE public.core_projects
  SET status = 'CLOSED', closed_at = now(), closed_by = v_uid, closed_by_name = v_name,
      close_note = NULLIF(TRIM(p_note), '')
  WHERE id = v_proj.id;

  INSERT INTO public.core_audit_logs (
    id, app, type, action, category, severity,
    user_id, user_name, user_trigram,
    table_name, record_id, title, description, meta, created_at
  ) VALUES (
    'AUD-PRJ-CLS-' || v_proj.id || '-' || substr(md5(random()::text), 1, 6),
    'stock', 'PROJECT_CLOSED', 'PROJECT_CLOSED', 'ADMIN', 'INFO',
    v_uid, v_name, v_trigram,
    'core_projects', v_proj.id::text,
    format('Projet terminé : %s', v_proj.project_number),
    format('Projet %s (%s) terminé par %s — sorties de matériel désormais interdites', v_proj.project_number, v_proj.project_name, v_name),
    jsonb_build_object('project_number', v_proj.project_number, 'note', NULLIF(TRIM(p_note), '')),
    now()
  );

  RETURN jsonb_build_object('success', true, 'project_number', v_proj.project_number, 'status', 'CLOSED');
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_project(p_project_number TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid TEXT;
  v_name TEXT;
  v_trigram TEXT;
  v_proj public.core_projects%ROWTYPE;
BEGIN
  IF current_user = 'anon' OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'anon' THEN
    RAISE EXCEPTION 'Accès refusé : rôle anonyme interdit.' USING ERRCODE = '42501';
  END IF;
  v_uid := public.current_user_id();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;
  SELECT name, trigram INTO v_name, v_trigram FROM public.core_users WHERE id::text = v_uid LIMIT 1;

  SELECT * INTO v_proj FROM public.core_projects WHERE project_number = TRIM(COALESCE(p_project_number, '')) FOR UPDATE;
  IF v_proj.id IS NULL THEN
    RAISE EXCEPTION 'Projet introuvable (%).', COALESCE(p_project_number, 'NULL') USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._tot_can_manage_project(v_proj.project_number) THEN
    RAISE EXCEPTION 'Accès refusé : seuls un administrateur, le responsable du département ou le gestionnaire du projet (et suppléants) peuvent rouvrir ce projet.' USING ERRCODE = '42501';
  END IF;
  IF v_proj.status <> 'CLOSED' THEN
    RAISE EXCEPTION 'Le projet % est déjà en cours.', v_proj.project_number USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.project_rpc', 'on', true);
  UPDATE public.core_projects
  SET status = 'IN_PROGRESS', closed_at = NULL, closed_by = NULL, closed_by_name = NULL, close_note = NULLIF(TRIM(p_note), '')
  WHERE id = v_proj.id;

  INSERT INTO public.core_audit_logs (
    id, app, type, action, category, severity,
    user_id, user_name, user_trigram,
    table_name, record_id, title, description, meta, created_at
  ) VALUES (
    'AUD-PRJ-OPN-' || v_proj.id || '-' || substr(md5(random()::text), 1, 6),
    'stock', 'PROJECT_REOPENED', 'PROJECT_REOPENED', 'ADMIN', 'INFO',
    v_uid, v_name, v_trigram,
    'core_projects', v_proj.id::text,
    format('Projet rouvert : %s', v_proj.project_number),
    format('Projet %s (%s) rouvert par %s', v_proj.project_number, v_proj.project_name, v_name),
    jsonb_build_object('project_number', v_proj.project_number, 'note', NULLIF(TRIM(p_note), '')),
    now()
  );

  RETURN jsonb_build_object('success', true, 'project_number', v_proj.project_number, 'status', 'IN_PROGRESS');
END;
$$;

REVOKE ALL ON FUNCTION public.close_project(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_project(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_project(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reopen_project(TEXT, TEXT) TO authenticated, service_role;

-- Sorties de matériel et commandes interdites sur un projet terminé (les entrées / retours restent permis)
DROP FUNCTION IF EXISTS public.block_closed_project_usage() CASCADE;
CREATE OR REPLACE FUNCTION public.block_closed_project_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site TEXT;
BEGIN
  v_site := NULLIF(TRIM(COALESCE(NEW.site_number, '')), '');
  IF v_site IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'stk_movements' THEN
    IF NEW.movement_type IS DISTINCT FROM 'OUT' THEN
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'stk_material_orders' THEN
    IF TG_OP = 'UPDATE' AND NEW.status IN ('CANCELLED', 'REJECTED') THEN
      RETURN NEW; -- annuler / refuser reste possible
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.core_projects p WHERE p.project_number = v_site AND p.status = 'CLOSED') THEN
    RAISE EXCEPTION 'Le projet % est terminé : sortie de matériel et commandes interdites (rouvrez le projet si nécessaire).', v_site
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.block_closed_project_usage() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_block_closed_project_movements ON public.stk_movements;
CREATE TRIGGER trg_block_closed_project_movements
  BEFORE INSERT ON public.stk_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.block_closed_project_usage();

DROP TRIGGER IF EXISTS trg_block_closed_project_orders_ins ON public.stk_material_orders;
CREATE TRIGGER trg_block_closed_project_orders_ins
  BEFORE INSERT ON public.stk_material_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.block_closed_project_usage();

DROP TRIGGER IF EXISTS trg_block_closed_project_orders_upd ON public.stk_material_orders;
CREATE TRIGGER trg_block_closed_project_orders_upd
  BEFORE UPDATE OF status ON public.stk_material_orders
  FOR EACH ROW
  WHEN (NEW.status IN ('PENDING', 'PREPARING', 'READY', 'COLLECTED'))
  EXECUTE FUNCTION public.block_closed_project_usage();
