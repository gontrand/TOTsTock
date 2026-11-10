-- =========================================================================
-- 22_departement_logistique.sql — Département « Logistique » & sortie directe sur dépôt fixe
-- =========================================================================
-- Règle (v61) : une SORTIE DIRECTE (process_stock_movement, type OUT) depuis un dépôt FIXE (magasin central)
-- est réservée :
--   - aux administrateurs (rôles 0 et 1),
--   - aux magasiniers, responsables logistique / magasin (rôles 2, 6, 7) et aux préparateurs (is_preparer),
--   - au personnel d'un département coché « Logistique » (core_departments.is_logistics_dept).
-- Les autres utilisateurs passent par une COMMANDE (préparée par le magasinier, retrait signé).
-- Camionnettes (VEHICLE) et conteneurs (CONTAINER) : AUCUN changement (titulaire, binômes, responsables).
-- Les commandes, transferts et inventaires ne sont pas concernés (ils n'utilisent pas ce contrôle).
-- Idempotent : peut être rejoué sans effet de bord.
-- =========================================================================

-- 1. Case « Logistique » sur le département
ALTER TABLE public.core_departments
  ADD COLUMN IF NOT EXISTS is_logistics_dept BOOLEAN DEFAULT false;

-- 2. Reprise automatique la première fois : les départements dont le nom contient « logisti » sont cochés
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.core_departments WHERE COALESCE(is_logistics_dept, false) = true) THEN
    UPDATE public.core_departments
    SET is_logistics_dept = true
    WHERE LOWER(name) LIKE '%logisti%';
  END IF;
END $$;

-- 3. L'appelant a-t-il le droit de faire une sortie directe depuis un dépôt fixe ?
DROP FUNCTION IF EXISTS public.can_direct_out_fixed_depot() CASCADE;
CREATE OR REPLACE FUNCTION public.can_direct_out_fixed_depot()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role INT;
  v_dept TEXT;
  v_preparer BOOLEAN;
BEGIN
  SELECT role_id, department, COALESCE(is_preparer, false)
  INTO v_role, v_dept, v_preparer
  FROM public.core_users
  WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;
  IF v_role IN (0, 1, 2, 6, 7) OR v_preparer THEN
    RETURN TRUE;
  END IF;
  IF v_dept IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.core_departments d
    WHERE LOWER(TRIM(d.name)) = LOWER(TRIM(v_dept))
      AND COALESCE(d.is_logistics_dept, false) = true
  ) THEN
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$$;

-- 4. Contrôle appelé par process_stock_movement (script 04) pour les sorties directes
DROP FUNCTION IF EXISTS public._tot_assert_direct_out_allowed(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public._tot_assert_direct_out_allowed(p_depot TEXT, p_type TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_depot_type TEXT;
BEGIN
  IF UPPER(COALESCE(p_type, '')) <> 'OUT' THEN
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(UPPER(TRIM(type)), ''), 'FIXED')
  INTO v_depot_type
  FROM public.stk_depots
  WHERE LOWER(TRIM(name)) = LOWER(TRIM(COALESCE(p_depot, '')))
  LIMIT 1;

  -- Dépôt introuvable (ex. « Dépôt Principal » implicite) : traité comme dépôt fixe
  v_depot_type := COALESCE(v_depot_type, 'FIXED');

  IF v_depot_type IN ('VEHICLE', 'CONTAINER') THEN
    RETURN; -- règles titulaire / binômes / responsables inchangées
  END IF;

  IF NOT public.can_direct_out_fixed_depot() THEN
    RAISE EXCEPTION 'Sortie directe interdite sur le dépôt fixe « % » : passez par une commande (préparée par le magasin) ou demandez au personnel Logistique.', p_depot
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.can_direct_out_fixed_depot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_direct_out_fixed_depot() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._tot_assert_direct_out_allowed(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._tot_assert_direct_out_allowed(TEXT, TEXT) TO authenticated, service_role;

-- =========================================================================
-- 6. Validation des commandes au-dessus du seuil : contrôle côté SERVEUR (v62)
-- =========================================================================
-- Avant : seule l'application forçait « En attente de validation » quand le total atteint le seuil
-- du département (core_departments.order_approval_threshold). Un client modifié pouvait envoyer
-- directement une commande « PENDING ». Désormais le serveur corrige le statut à l'insertion.
-- Validateurs exemptés (identique à l'application) : rôles 0, 1, 2, 8, permission perm_order_approve,
-- responsable / adjoint du département ou du projet concerné.
-- Département retenu : celui du projet (site_number) sinon celui du compte de l'appelant.
-- Idempotent : peut être rejoué sans effet de bord.
-- =========================================================================
DROP FUNCTION IF EXISTS public.enforce_order_approval_threshold() CASCADE;
CREATE OR REPLACE FUNCTION public.enforce_order_approval_threshold()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid TEXT := public.current_user_id();
  v_role INT := public.current_user_role();
  v_site TEXT := UPPER(TRIM(COALESCE(NEW.site_number, '')));
  v_dept_id BIGINT;
  v_user_dept TEXT;
  v_require BOOLEAN := false;
  v_threshold NUMERIC := 0;
  v_is_approver BOOLEAN := false;
BEGIN
  -- Hors utilisateur connecté (rôle service, scripts d'administration) : aucun contrôle
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Seules les commandes créées directement « PENDING » sont concernées
  IF NEW.status IS DISTINCT FROM 'PENDING' THEN
    RETURN NEW;
  END IF;

  -- Département du projet (chantier) si reconnu
  IF v_site <> '' THEN
    SELECT p.department_id INTO v_dept_id
    FROM public.core_projects p
    WHERE UPPER(TRIM(p.project_number)) = v_site
       OR v_site LIKE '%' || UPPER(TRIM(p.project_number)) || '%'
    ORDER BY (UPPER(TRIM(p.project_number)) = v_site) DESC
    LIMIT 1;
  END IF;

  IF v_dept_id IS NOT NULL THEN
    SELECT COALESCE(d.require_order_approval, false), COALESCE(d.order_approval_threshold, 0)
    INTO v_require, v_threshold
    FROM public.core_departments d
    WHERE d.id = v_dept_id;
  END IF;

  -- Sinon département du compte de l'appelant (et non la valeur envoyée par le client)
  IF v_dept_id IS NULL OR v_require IS NOT TRUE THEN
    SELECT u.department INTO v_user_dept
    FROM public.core_users u
    WHERE (u.auth_user_id = auth.uid() OR u.id::text = auth.uid()::text)
    LIMIT 1;

    IF v_dept_id IS NULL AND v_user_dept IS NOT NULL THEN
      SELECT COALESCE(d.require_order_approval, false), COALESCE(d.order_approval_threshold, 0)
      INTO v_require, v_threshold
      FROM public.core_departments d
      WHERE LOWER(TRIM(d.name)) = LOWER(TRIM(v_user_dept))
      LIMIT 1;
    END IF;
  END IF;

  IF COALESCE(v_require, false) IS NOT TRUE OR COALESCE(NEW.total_cost, 0) < COALESCE(v_threshold, 0) THEN
    RETURN NEW;
  END IF;

  v_is_approver :=
    public.is_super_admin()
    OR v_role IN (0, 1, 2, 8)
    OR public.current_user_has_perm('perm_order_approve')
    OR public.current_user_is_dept_or_proj_manager_for_order(NEW.requester_department, NEW.site_number);

  IF NOT v_is_approver THEN
    NEW.status := 'WAITING_APPROVAL';
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_order_approval_threshold() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_enforce_order_approval_threshold ON public.stk_material_orders;
CREATE TRIGGER trg_enforce_order_approval_threshold
  BEFORE INSERT ON public.stk_material_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_order_approval_threshold();
