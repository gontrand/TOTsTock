-- =========================================================================
-- TOT STOCK - SCRIPT 10 : SUPPRESSION DES VUES DE COMPATIBILITÉ (10_drop_compat_views.sql)
-- À exécuter manuellement une fois que tous les postes mobiles et Bureau
-- ont été mis à jour en v5.5.0+ (schéma 2.0.0) et utilisent les tables core_* / stk_*.
-- Non exécuté par défaut lors de l'installation.
-- Rejouable : oui
-- =========================================================================

DO $$
DECLARE
  v_legacy_views TEXT[] := ARRAY[
    'users', 'roles', 'departments', 'projects',
    'company_settings', 'app_settings', 'license_config', 'app_compat',
    'audit_logs', 'login_logs', 'processed_operations', 'files',
    'products', 'categories', 'sub_categories', 'stock_levels',
    'depots', 'stock_movements', 'movements',
    'material_orders', 'material_order_items',
    'print_jobs', 'print_stations',
    'inventory_audits', 'inventory_audit_items', 'order_preparations_log'
  ];
  v_view TEXT;
BEGIN
  PERFORM set_config('tot.enable_compat_views', 'off', false);

  FOREACH v_view IN ARRAY v_legacy_views LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = v_view
        AND c.relkind = 'v'
    ) THEN
      EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', v_view);
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public._tot_refresh_compat_views();
