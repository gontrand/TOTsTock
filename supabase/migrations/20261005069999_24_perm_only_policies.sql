-- =========================================================================
-- FICHIER GÉNÉRÉ AUTOMATIQUEMENT PAR scripts/build-sql.mjs — NE PAS MODIFIER DIRECTEMENT
-- Source de vérité : supabase-client/24_perm_only_policies.sql
-- Étape 24 : v5.23.0 : grants étendus (service_role + authenticated + anon), seeding perm_admin_level sur rôles 0/1/2/5/6/8, policies 100% permissions
-- =========================================================================
-- =========================================================================
-- Étape 24 — v5.23.0 : passage 100% permissions (plus de role_id codés en dur
-- dans les policies RLS) + GRANT standards complets pour service_role,
-- authenticated et anon + seeding des permissions-clés sur les rôles existants.
--
-- Idempotent : rejouer ce script est sans risque.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. GRANT standards + ALTER DEFAULT PRIVILEGES (fix des installs où les
-- permissions de rôle PostgreSQL n'avaient pas été posées proprement).
-- -------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role, anon, authenticated;

GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES, SEQUENCES, FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;

-- -------------------------------------------------------------------------
-- 2. Seeding des permissions-clés sur les rôles existants
-- Les rôles 0 et 1 reçoivent perm_admin_level + les perms-paquet.
-- Les autres rôles sont laissés intacts (l'admin pourra ajouter des perms
-- depuis l'UI Gestion des utilisateurs & rôles).
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_admin_perms TEXT[] := ARRAY[
    'perm_admin_level',          -- v5.23.0 : pivot « droits d'administration »
    'perm_manage_users',
    'perm_manage_roles',
    'perm_manage_depots',
    'perm_depot_view_all',
    'perm_config_db',
    'perm_config_email',
    'perm_mail_admin',
    'perm_config_license',
    'perm_audit_view',
    'perm_view_all_login_logs',
    'perm_diagnostic',
    'perm_report_view',
    'perm_mov_view_all',
    'perm_orders_manage',
    'perm_order_approve',
    'perm_orders_prepare',
    'perm_transfer_validate',
    'perm_stock_receive_all',
    'perm_products_manage',
    'perm_inventory_validate',
    'perm_menu_inventory_audit',
    'perm_user_force_pin',
    'perm_manage_currency'
  ];
BEGIN
  -- Rôle 0 (super admin) : on force la présence du wildcard '*' qui bypasse tout
  UPDATE public.core_roles
     SET permissions = (
           SELECT array_agg(DISTINCT p)
             FROM unnest(COALESCE(permissions, ARRAY[]::text[]) || ARRAY['*']) AS p
         )
   WHERE id = 0;

  -- Rôle 1 (Administrateur) : réception du paquet administrateur complet
  UPDATE public.core_roles
     SET permissions = (
           SELECT array_agg(DISTINCT p)
             FROM unnest(COALESCE(permissions, ARRAY[]::text[]) || v_admin_perms) AS p
         )
   WHERE id = 1;

  -- Rôle 2 (Responsable Dépôt / Magasinier) : perms dépôts + préparation
  UPDATE public.core_roles
     SET permissions = (
           SELECT array_agg(DISTINCT p)
             FROM unnest(COALESCE(permissions, ARRAY[]::text[]) ||
               ARRAY['perm_manage_depots','perm_depot_view_all',
                     'perm_orders_prepare','perm_stock_receive_all',
                     'perm_transfer_validate']) AS p
         )
   WHERE id = 2;

  -- Rôle 5 (Administrateur Informatique) : paquet IT (diagnostic + config DB)
  UPDATE public.core_roles
     SET permissions = (
           SELECT array_agg(DISTINCT p)
             FROM unnest(COALESCE(permissions, ARRAY[]::text[]) ||
               ARRAY['perm_diagnostic','perm_config_db','perm_audit_view',
                     'perm_view_all_login_logs']) AS p
         )
   WHERE id = 5;

  -- Rôle 6 (Responsable Logistique) : logistique + dépôts
  UPDATE public.core_roles
     SET permissions = (
           SELECT array_agg(DISTINCT p)
             FROM unnest(COALESCE(permissions, ARRAY[]::text[]) ||
               ARRAY['perm_depot_view_all','perm_manage_depots',
                     'perm_orders_prepare','perm_transfer_validate',
                     'perm_stock_receive_all']) AS p
         )
   WHERE id = 6;

  -- Rôle 8 (Responsable de Département) : approbation commandes + audit
  UPDATE public.core_roles
     SET permissions = (
           SELECT array_agg(DISTINCT p)
             FROM unnest(COALESCE(permissions, ARRAY[]::text[]) ||
               ARRAY['perm_order_approve','perm_orders_manage',
                     'perm_audit_view']) AS p
         )
   WHERE id = 8;
END $$;

-- -------------------------------------------------------------------------
-- 3. Refactor des policies RLS historiques qui filtrent sur role_id
--    vers des vérifications 100% permissions. Seul role_id = 0 reste
--    reconnu en dur à l'intérieur de current_user_has_perm (bypass super admin).
-- -------------------------------------------------------------------------
DO $$ DECLARE r RECORD; BEGIN
  -- core_app_settings : policy « Admin write »
  FOR r IN SELECT policyname FROM pg_policies
            WHERE schemaname='public' AND tablename='core_app_settings'
              AND policyname = 'Admin write app_settings'
  LOOP
    EXECUTE 'DROP POLICY "Admin write app_settings" ON public.core_app_settings';
  END LOOP;
END $$;

CREATE POLICY "Admin write app_settings"
  ON public.core_app_settings
  FOR ALL
  TO authenticated
  USING (
    public.current_user_has_perm('perm_config_db')
    OR public.current_user_has_perm('perm_manage_users')
    OR public.current_user_has_perm('perm_admin_level')
    OR (public.current_user_id() IS NOT NULL
        AND key IN ('company_orders_sync', 'company_user_baskets'))
  )
  WITH CHECK (
    public.current_user_has_perm('perm_config_db')
    OR public.current_user_has_perm('perm_manage_users')
    OR public.current_user_has_perm('perm_admin_level')
    OR (public.current_user_id() IS NOT NULL
        AND key IN ('company_orders_sync', 'company_user_baskets'))
  );

-- stk_depots : policies INSERT/UPDATE/DELETE 100% permissions
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT policyname FROM pg_policies
            WHERE schemaname='public' AND tablename='stk_depots'
              AND policyname IN ('depots_insert_admin','depots_update_admin','depots_delete_admin','Admin write depots')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.stk_depots', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "depots_insert_by_perm" ON public.stk_depots
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_has_perm('perm_manage_depots')
              OR public.current_user_has_perm('perm_depot_create'));

CREATE POLICY "depots_update_by_perm" ON public.stk_depots
  FOR UPDATE TO authenticated
  USING      (public.current_user_has_perm('perm_manage_depots')
              OR public.current_user_has_perm('perm_depot_create'))
  WITH CHECK (public.current_user_has_perm('perm_manage_depots')
              OR public.current_user_has_perm('perm_depot_create'));

CREATE POLICY "depots_delete_by_perm" ON public.stk_depots
  FOR DELETE TO authenticated
  USING (public.current_user_has_perm('perm_manage_depots')
         OR public.current_user_has_perm('perm_depot_create'));

-- core_user_preferences : policy complémentaire autorisant un admin à seeder
-- les préférences d'un AUTRE utilisateur (création d'utilisateur par l'admin).
DROP POLICY IF EXISTS "Admin seed others core_user_preferences" ON public.core_user_preferences;
CREATE POLICY "Admin seed others core_user_preferences"
  ON public.core_user_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_has_perm('perm_manage_users')
    OR public.current_user_has_perm('perm_admin_level')
  );

-- -------------------------------------------------------------------------
-- 4. Notice de fin
-- -------------------------------------------------------------------------
DO $$ BEGIN
  RAISE NOTICE '=== [TOT STOCK v5.23.0] Étape 24 : grants étendus, seeding perm_admin_level, policies 100%% permissions ===';
END $$;
