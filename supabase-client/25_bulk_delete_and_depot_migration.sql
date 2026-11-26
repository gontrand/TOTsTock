-- =========================================================================
-- Étape 25 — v5.24.0 : suppression multiple de références + migration du
-- contenu d'un dépôt vers un autre dépôt avant sa suppression.
--
-- 1. perm_prod_delete est ajoutée aux rôles de niveau administration
--    (ceux qui possèdent perm_admin_level) — aucun id de rôle en dur.
-- 2. public.delete_products_bulk(p_ids text[]) : suppression par lot (500 max),
--    transactionnelle, réservée aux détenteurs de perm_prod_delete.
-- 3. public.migrate_depot_content(p_source text, p_target text) : déplace TOUT
--    le contenu du dépôt source vers le dépôt cible (niveaux de stock fusionnés
--    par somme des quantités, références rattachées), transactionnelle,
--    réservée aux détenteurs de perm_manage_depots. Ne supprime pas le dépôt.
--
-- Idempotent : rejouer ce script est sans risque.
-- =========================================================================

-- 1. Permission de suppression pour les rôles administration
UPDATE public.core_roles
   SET permissions = array_append(COALESCE(permissions, '{}'::text[]), 'perm_prod_delete')
 WHERE 'perm_admin_level' = ANY (COALESCE(permissions, '{}'::text[]))
   AND NOT ('perm_prod_delete' = ANY (COALESCE(permissions, '{}'::text[])));

-- 2. Suppression multiple de références
CREATE OR REPLACE FUNCTION public.delete_products_bulk(p_ids TEXT[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT := 0;
BEGIN
  IF public.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED : connexion requise' USING ERRCODE = '28000';
  END IF;
  IF NOT public.current_user_has_perm('perm_prod_delete') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED : permission perm_prod_delete requise' USING ERRCODE = '42501';
  END IF;
  IF p_ids IS NULL OR COALESCE(array_length(p_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('deleted', 0);
  END IF;
  IF array_length(p_ids, 1) > 500 THEN
    RAISE EXCEPTION 'TOO_MANY_ITEMS : 500 références maximum par lot' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.stk_stock_levels WHERE product_id = ANY (p_ids);
  DELETE FROM public.stk_products WHERE id = ANY (p_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;

-- 3. Migration du contenu d'un dépôt vers un autre
CREATE OR REPLACE FUNCTION public.migrate_depot_content(p_source TEXT, p_target TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src TEXT;
  v_tgt TEXT;
  v_merged INT := 0;
  v_moved INT := 0;
  v_products INT := 0;
BEGIN
  IF public.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED : connexion requise' USING ERRCODE = '28000';
  END IF;
  IF NOT public.current_user_has_perm('perm_manage_depots') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED : permission perm_manage_depots requise' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_src FROM public.stk_depots WHERE lower(name) = lower(btrim(COALESCE(p_source, ''))) LIMIT 1;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'DEPOT_SOURCE_NOT_FOUND : dépôt source introuvable' USING ERRCODE = '22023';
  END IF;
  SELECT name INTO v_tgt FROM public.stk_depots WHERE lower(name) = lower(btrim(COALESCE(p_target, ''))) LIMIT 1;
  IF v_tgt IS NULL THEN
    RAISE EXCEPTION 'DEPOT_TARGET_NOT_FOUND : dépôt cible introuvable' USING ERRCODE = '22023';
  END IF;
  IF v_src = v_tgt THEN
    RAISE EXCEPTION 'SAME_DEPOT : le dépôt cible doit être différent du dépôt source' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.stock_rpc', 'on', true);

  -- a) Produits déjà présents dans le dépôt cible : on additionne les quantités
  UPDATE public.stk_stock_levels t
     SET quantity = COALESCE(t.quantity, 0) + COALESCE(s.quantity, 0),
         min_stock = GREATEST(COALESCE(t.min_stock, 0), COALESCE(s.min_stock, 0)),
         rack_location = COALESCE(NULLIF(t.rack_location, ''), s.rack_location),
         updated_at = now()
    FROM public.stk_stock_levels s
   WHERE s.depot_name = v_src
     AND t.depot_name = v_tgt
     AND t.product_id = s.product_id;
  GET DIAGNOSTICS v_merged = ROW_COUNT;

  DELETE FROM public.stk_stock_levels s
   USING public.stk_stock_levels t
   WHERE s.depot_name = v_src
     AND t.depot_name = v_tgt
     AND t.product_id = s.product_id;

  -- b) Les autres lignes de stock changent simplement de dépôt
  UPDATE public.stk_stock_levels
     SET depot_name = v_tgt, updated_at = now()
   WHERE depot_name = v_src;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- c) Références rattachées au dépôt source
  UPDATE public.stk_products
     SET store_name = v_tgt, updated_at = now()
   WHERE lower(store_name) = lower(v_src);
  GET DIAGNOSTICS v_products = ROW_COUNT;

  RETURN jsonb_build_object(
    'source', v_src,
    'target', v_tgt,
    'stock_lines_merged', v_merged,
    'stock_lines_moved', v_moved,
    'products_reassigned', v_products
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_products_bulk(TEXT[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.migrate_depot_content(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_products_bulk(TEXT[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.migrate_depot_content(TEXT, TEXT) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- v5.24.1 : expéditeur vide autorisé (core_mail_senders.from_email = '')
-- L'interface indique « adresse vide : l'envoi utilisera l'adresse du compte
-- d'envoi actif ». L'ancienne contrainte refusait la chaîne vide.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.core_mail_senders') IS NOT NULL THEN
    ALTER TABLE public.core_mail_senders DROP CONSTRAINT IF EXISTS core_mail_senders_from_email_chk;
    ALTER TABLE public.core_mail_senders ADD CONSTRAINT core_mail_senders_from_email_chk CHECK (
      from_email = ''
      OR from_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    );
  END IF;
END $$;
