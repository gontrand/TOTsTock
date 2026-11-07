-- =========================================================================
-- TOT SUITE - SCRIPT 13 : TRANSFERT DE MATÉRIEL ENTRE DÉPÔTS PAR LOT (13_transfer_stock_batch.sql)
-- Schéma 2.3.0
--
-- 1. Patche public.process_stock_movement pour que la branche TRANSFER accepte
--    la permission perm_stock_transfer (en plus des rôles 0/1 et des permissions existantes).
--    Le patch cible la branche TRANSFER par texte indépendamment des espaces ;
--    si la branche n'est pas reconnue, il échoue avec un message clair.
-- 2. Crée public.transfer_stock_batch(p_batch_id uuid, p_source_depot text, p_dest_depot text, p_items jsonb, p_reason text) :
--    - De 1 à 200 lignes [{product_id, quantity, dest_rack?}]
--    - Tout ou rien (transactionnel : une erreur sur une ligne annule tout le lot)
--    - Idempotent sur p_batch_id via public.core_processed_operations
--    - Réservé aux rôles 0 / 1 ou aux détenteurs de perm_stock_transfer
--    - Refusé pour anon et pour tout appelant non connecté / bloqué
--
-- Doit être exécuté après 12_user_preferences.sql et avant 07_app_compat.sql.
-- Rejouable : oui (idempotent)
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. PATCH IDEMPOTENT DE LA BRANCHE TRANSFER DANS public.process_stock_movement
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_func_oid OID;
  v_func_def TEXT;
  v_patched_def TEXT;
BEGIN
  SELECT p.oid
  INTO v_func_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'process_stock_movement'
    AND p.pronargs = 12
  LIMIT 1;

  IF v_func_oid IS NULL THEN
    RAISE EXCEPTION 'Patch 13_transfer_stock_batch : fonction public.process_stock_movement (12 paramètres) introuvable. Exécutez les scripts 03 et 04 avant le script 13.';
  END IF;

  v_func_def := pg_get_functiondef(v_func_oid);

  -- Vérifie que la branche TRANSFER est présente (indépendamment des espaces et retours à la ligne)
  IF v_func_def !~* 'ELSIF\s+v_mov_type\s*=\s*''TRANSFER''\s+THEN\s+IF\s+NOT\s*\(' THEN
    RAISE EXCEPTION 'Patch 13_transfer_stock_batch : branche ELSIF v_mov_type = ''TRANSFER'' non reconnue dans public.process_stock_movement.';
  END IF;

  -- Si perm_stock_transfer n'est pas encore testé dans la branche TRANSFER, l'injecter
  IF v_func_def !~* 'ELSIF\s+v_mov_type\s*=\s*''TRANSFER''\s+THEN[\s\S]*?current_user_has_perm\(\s*''perm_stock_transfer''\s*\)' THEN
    v_patched_def := regexp_replace(
      v_func_def,
      '(ELSIF\s+v_mov_type\s*=\s*''TRANSFER''\s+THEN\s+IF\s+NOT\s*\(\s*)',
      E'\\1public.current_user_has_perm(''perm_stock_transfer'') OR ',
      'i'
    );

    IF v_patched_def = v_func_def OR v_patched_def !~* 'current_user_has_perm\(\s*''perm_stock_transfer''\s*\)' THEN
      RAISE EXCEPTION 'Patch 13_transfer_stock_batch : échec de l''injection de perm_stock_transfer dans la branche TRANSFER de public.process_stock_movement.';
    END IF;

    EXECUTE v_patched_def;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.process_stock_movement(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_stock_movement(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;

-- -------------------------------------------------------------------------
-- 2. RPC DE TRANSFERT MULTI-ARTICLES ATOMIQUE : public.transfer_stock_batch
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.transfer_stock_batch(UUID, TEXT, TEXT, JSONB, TEXT) CASCADE;
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
DECLARE
  v_caller_id TEXT;
  v_caller_role INT;
  v_caller_name TEXT;
  v_caller_trigram TEXT;
  v_caller_dept TEXT;
  v_allowed_depots TEXT[];
  v_is_blocked BOOLEAN;
  v_existing_op RECORD;

  v_source_depot TEXT;
  v_dest_depot TEXT;
  v_clean_reason TEXT;
  v_item_count INT;
  v_idx INT;
  v_item JSONB;

  v_product_id TEXT;
  v_qty NUMERIC;
  v_dest_rack TEXT;
  v_product_ref TEXT;
  v_unit_price NUMERIC;
  v_prod_initial_qty NUMERIC;
  v_prod_store_name TEXT;

  v_current_source_stock NUMERIC;
  v_new_source_stock NUMERIC;
  v_current_dest_stock NUMERIC;
  v_new_dest_stock NUMERIC;
  v_total_product_stock NUMERIC;
  v_line_cost NUMERIC;
  v_total_batch_cost NUMERIC := 0;
  v_total_pieces NUMERIC := 0;

  v_mov_id TEXT;
  v_applied_items JSONB := '[]'::jsonb;
  v_result JSONB;
BEGIN
  -- 0. Refus explicite du rôle anon et des appels non authentifiés
  IF current_user = 'anon' OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'anon' THEN
    RAISE EXCEPTION 'Permission denied: anonymous access is forbidden for transfer_stock_batch' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required: user is not signed in' USING ERRCODE = '42501';
  END IF;

  -- 1. Identification et vérification du profil appelant
  SELECT id::text, role_id, name, trigram, department, allowed_depots, is_blocked
  INTO v_caller_id, v_caller_role, v_caller_name, v_caller_trigram, v_caller_dept, v_allowed_depots, v_is_blocked
  FROM public.core_users
  WHERE auth_user_id = auth.uid() AND COALESCE(is_blocked, false) = false
  LIMIT 1;

  IF v_caller_id IS NULL OR v_is_blocked = TRUE THEN
    RAISE EXCEPTION 'User profile not found or blocked' USING ERRCODE = '42501';
  END IF;

  -- 2. Vérification de la permission : rôles 0/1 ou perm_stock_transfer
  IF NOT (
    public.is_super_admin()
    OR v_caller_role IN (0, 1)
    OR public.current_user_has_perm('perm_stock_transfer')
  ) THEN
    RAISE EXCEPTION 'Permission denied: perm_stock_transfer required for inter-depot stock transfer' USING ERRCODE = '42501';
  END IF;

  -- 3. Validation de p_batch_id et idempotence stricte via core_processed_operations
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

  -- 4. Validation des dépôts source et destination
  v_source_depot := NULLIF(TRIM(COALESCE(p_source_depot, '')), '');
  v_dest_depot := NULLIF(TRIM(COALESCE(p_dest_depot, '')), '');

  IF v_source_depot IS NULL OR v_dest_depot IS NULL THEN
    RAISE EXCEPTION 'Source depot and destination depot are required' USING ERRCODE = '22023';
  END IF;

  IF LOWER(v_source_depot) = LOWER(v_dest_depot) THEN
    RAISE EXCEPTION 'Le dépôt de destination ("%") doit être distinct du dépôt source ("%").', v_dest_depot, v_source_depot USING ERRCODE = '22023';
  END IF;

  -- Refus si l'un des dépôts est explicitement fermé / inactif dans stk_depots
  IF EXISTS (
    SELECT 1 FROM public.stk_depots
    WHERE LOWER(TRIM(name)) IN (LOWER(v_source_depot), LOWER(v_dest_depot))
      AND COALESCE(is_active, true) = false
  ) THEN
    RAISE EXCEPTION 'Transfert refusé : le dépôt source ou le dépôt de destination est fermé ou inactif.' USING ERRCODE = '22023';
  END IF;

  -- Vérification des dépôts autorisés (allowed_depots) sauf rôles 0 et 1
  IF NOT (public.is_super_admin() OR v_caller_role IN (0, 1)) THEN
    IF v_allowed_depots IS NOT NULL AND array_length(v_allowed_depots, 1) > 0 THEN
      IF NOT ('*' = ANY(v_allowed_depots) OR 'ALL' = ANY(v_allowed_depots) OR v_source_depot = ANY(v_allowed_depots)) THEN
        RAISE EXCEPTION 'Accès refusé au dépôt source "%". Vos droits ne couvrent pas ce magasin.', v_source_depot USING ERRCODE = '42501';
      END IF;
      IF NOT ('*' = ANY(v_allowed_depots) OR 'ALL' = ANY(v_allowed_depots) OR v_dest_depot = ANY(v_allowed_depots)) THEN
        RAISE EXCEPTION 'Accès refusé au dépôt destination "%". Vos droits ne couvrent pas ce magasin.', v_dest_depot USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- 5. Validation de la liste d'articles (1 à 200 lignes)
  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' THEN
    RAISE EXCEPTION 'p_items must be a non-empty JSON array' USING ERRCODE = '22023';
  END IF;

  v_item_count := jsonb_array_length(p_items);
  IF v_item_count < 1 OR v_item_count > 200 THEN
    RAISE EXCEPTION 'Le lot de transfert doit contenir entre 1 et 200 articles (reçu : %).', v_item_count USING ERRCODE = '22023';
  END IF;

  v_clean_reason := COALESCE(NULLIF(TRIM(COALESCE(p_reason, '')), ''), format('Transfert %s -> %s', v_source_depot, v_dest_depot));

  -- Autorisation du trigger de verrouillage de stk_products.quantity dans la transaction
  PERFORM set_config('app.stock_rpc', 'on', true);

  -- 6. Traitement atomique (tout ou rien) de chaque ligne du lot
  FOR v_idx IN 0 .. (v_item_count - 1) LOOP
    v_item := p_items -> v_idx;
    IF v_item IS NULL OR jsonb_typeof(v_item) != 'object' THEN
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

    -- Verrouillage FOR UPDATE de l'article dans stk_products
    SELECT reference, unit_price, COALESCE(quantity, 0), COALESCE(NULLIF(TRIM(store_name), ''), 'Dépôt Principal')
    INTO v_product_ref, v_unit_price, v_prod_initial_qty, v_prod_store_name
    FROM public.stk_products
    WHERE id::text = v_product_id
    FOR UPDATE;

    IF v_product_ref IS NULL THEN
      RAISE EXCEPTION 'Article introuvable (ID: %).', v_product_id USING ERRCODE = 'P0002';
    END IF;

    -- Initialisation paresseuse de stk_stock_levels si aucune ligne n'existe pour ce produit
    IF NOT EXISTS (SELECT 1 FROM public.stk_stock_levels WHERE product_id = v_product_id) THEN
      INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, updated_at)
      VALUES (v_product_id, v_prod_store_name, v_prod_initial_qty, now())
      ON CONFLICT (product_id, depot_name) DO NOTHING;
    END IF;

    INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, updated_at)
    VALUES (v_product_id, v_source_depot, 0, now())
    ON CONFLICT (product_id, depot_name) DO NOTHING;

    SELECT quantity
    INTO v_current_source_stock
    FROM public.stk_stock_levels
    WHERE product_id = v_product_id AND depot_name = v_source_depot
    FOR UPDATE;

    IF v_current_source_stock < v_qty THEN
      RAISE EXCEPTION 'Stock insuffisant dans le dépôt "%" pour "%" (Disponible: %, Demandé: %).',
        v_source_depot, COALESCE(v_product_ref, v_product_id), v_current_source_stock, v_qty
        USING ERRCODE = '23514';
    END IF;

    v_new_source_stock := v_current_source_stock - v_qty;

    UPDATE public.stk_stock_levels
    SET quantity = v_new_source_stock,
        updated_at = now()
    WHERE product_id = v_product_id AND depot_name = v_source_depot;

    -- Mise à jour du dépôt de destination
    INSERT INTO public.stk_stock_levels (product_id, depot_name, quantity, rack_location, updated_at)
    VALUES (v_product_id, v_dest_depot, 0, v_dest_rack, now())
    ON CONFLICT (product_id, depot_name) DO NOTHING;

    SELECT quantity
    INTO v_current_dest_stock
    FROM public.stk_stock_levels
    WHERE product_id = v_product_id AND depot_name = v_dest_depot
    FOR UPDATE;

    v_new_dest_stock := v_current_dest_stock + v_qty;

    UPDATE public.stk_stock_levels
    SET quantity = v_new_dest_stock,
        rack_location = COALESCE(v_dest_rack, rack_location),
        updated_at = now()
    WHERE product_id = v_product_id AND depot_name = v_dest_depot;

    -- Recalcul de la quantité totale du produit (somme de tous les dépôts)
    SELECT COALESCE(SUM(quantity), 0)
    INTO v_total_product_stock
    FROM public.stk_stock_levels
    WHERE product_id = v_product_id;

    -- Ne met à jour store_name / shelf_name de stk_products QUE si le stock du dépôt source tombe à 0
    UPDATE public.stk_products
    SET quantity = v_total_product_stock,
        store_name = CASE WHEN v_new_source_stock = 0 THEN v_dest_depot ELSE store_name END,
        shelf_name = CASE WHEN v_new_source_stock = 0 AND v_dest_rack IS NOT NULL THEN v_dest_rack ELSE shelf_name END,
        updated_at = now()
    WHERE id::text = v_product_id;

    v_mov_id := 'MOV-TRF-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || p_batch_id::text || '-' || (v_idx + 1)::text;
    v_line_cost := ROUND(v_qty * COALESCE(v_unit_price, 0), 2);
    v_total_batch_cost := v_total_batch_cost + v_line_cost;
    v_total_pieces := v_total_pieces + v_qty;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stk_movements') THEN
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
        format('TRANSFERT -> %s', v_dest_depot),
        COALESCE(v_caller_dept, 'Logistique'),
        v_line_cost,
        v_source_depot,
        v_dest_depot,
        now()
      );
    END IF;

    v_applied_items := v_applied_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product_id,
        'product_ref', v_product_ref,
        'quantity', v_qty,
        'dest_rack', v_dest_rack,
        'old_source_quantity', v_current_source_stock,
        'source_depot_quantity', v_new_source_stock,
        'dest_depot_quantity', v_new_dest_stock,
        'new_quantity', v_total_product_stock,
        'store_name_updated', (v_new_source_stock = 0),
        'movement_id', v_mov_id
      )
    );
  END LOOP;

  -- 7. Une seule entrée d'audit par lot de transfert dans core_audit_logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'core_audit_logs') THEN
    INSERT INTO public.core_audit_logs (
      id, app, type, category, user_id, user_name, user_trigram,
      quantity_changed, site_number, depot_name,
      title, description, badge_text, meta, created_at
    ) VALUES (
      'AUD-TRF-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || p_batch_id::text,
      'stock',
      'STOCK_TRANSFER',
      'MOVEMENTS',
      v_caller_id,
      v_caller_name,
      v_caller_trigram,
      v_total_pieces,
      format('TRANSFERT -> %s', v_dest_depot),
      v_source_depot,
      format('Transfert inter-dépôts (%s art., %s pce(s))', v_item_count, v_total_pieces),
      format('Transfert de %s article(s) (%s pièce(s)) : %s → %s par %s (%s)',
        v_item_count, v_total_pieces, v_source_depot, v_dest_depot, v_caller_name, v_clean_reason),
      format('%s → %s', v_source_depot, v_dest_depot),
      jsonb_build_object(
        'batch_id', p_batch_id,
        'movement_type', 'TRANSFER',
        'source_depot', v_source_depot,
        'dest_depot', v_dest_depot,
        'item_count', v_item_count,
        'total_pieces', v_total_pieces,
        'total_cost', v_total_batch_cost,
        'reason', v_clean_reason,
        'items', v_applied_items
      ),
      now()
    );
  END IF;

  -- 8. Enregistrement du résultat dans core_processed_operations (idempotence sur p_batch_id)
  v_result := jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'source_depot', v_source_depot,
    'dest_depot', v_dest_depot,
    'reason', v_clean_reason,
    'item_count', v_item_count,
    'total_pieces', v_total_pieces,
    'total_cost', v_total_batch_cost,
    'items', v_applied_items,
    'timestamp', now()
  );

  INSERT INTO public.core_processed_operations (
    operation_id, app, user_id, entity, action, action_type, result, created_at
  ) VALUES (
    p_batch_id, 'stock', v_caller_id, 'product_stock', 'TRANSFER_BATCH', 'STOCK_TRANSFER_BATCH', v_result, now()
  )
  ON CONFLICT (operation_id) DO NOTHING;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_stock_batch(UUID, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_stock_batch(UUID, TEXT, TEXT, JSONB, TEXT) TO authenticated;
