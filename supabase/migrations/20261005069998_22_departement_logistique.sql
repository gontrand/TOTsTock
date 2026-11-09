-- =========================================================================
-- FICHIER GÉNÉRÉ AUTOMATIQUEMENT PAR scripts/build-sql.mjs — NE PAS MODIFIER DIRECTEMENT
-- Source de vérité : supabase-client/22_departement_logistique.sql
-- Étape 22 : Case « Logistique » sur les départements et sortie directe sur dépôt fixe réservée (camions et conteneurs inchangés)
-- =========================================================================
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
