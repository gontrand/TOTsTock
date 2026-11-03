-- =========================================================================
-- 06_install_additional_roles.sql
-- TOT STOCK - SCRIPT D'INSTALLATION DES 6 NOUVEAUX RÔLES MÉTIER (5 À 10)
-- Rejouable : oui
-- =========================================================================
-- Ce script est 100% IDEMPOTENT et sans impact sur l'existant :
-- 1. Ne modifie pas les identifiants historiques 0 à 4 (Super Admin, Admin, Magasinier, Chef, Opérateur).
-- 2. Ne modifie le rôle (role_id) d'AUCUN utilisateur existant.
-- 3. Insère les 6 nouveaux rôles uniquement s'ils n'existent pas déjà.
--
-- Rôles historiques préservés :
--   0 : Super Administrateur 👑
--   1 : Administrateur 🏢
--   2 : Magasinier 📦
--   3 : Chef de chantier 🏗️
--   4 : Opérateur 🔨
--
-- Nouveaux rôles installés :
--   5 : Administrateur Informatique (IT) 💻
--   6 : Responsable Logistique 🚚
--   7 : Responsable Magasin 📋
--   8 : Responsable de Département 📁
--   9 : Intérimaire ⏱️
--   10 : Consultation 🔍
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. VÉRIFICATION DES PRÉREQUIS (Point 3)
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'roles'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (06_install_additional_roles.sql) : La table public.roles est absente. Exécutez d''abord 02_rls_hardening.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'roles' AND column_name = 'permissions'
  ) THEN
    RAISE EXCEPTION 'Prérequis manquant (06_install_additional_roles.sql) : La colonne public.roles.permissions est absente.';
  END IF;
END $$;

DO $$
BEGIN
  -- 5 : Administrateur Informatique (IT) 💻
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE id::text = '5') THEN
    INSERT INTO public.roles (id, name, permissions)
    VALUES (
      5,
      'Administrateur Informatique (IT) 💻',
      ARRAY[
        'perm_tab_plus',
        'perm_header_notifications', 'perm_header_sync_details', 'perm_header_license_badge', 'perm_header_language_switch', 'perm_header_theme_toggle', 'perm_header_app_info', 'perm_header_logout',
        'perm_menu_profile', 'perm_menu_language',
        'perm_manage_users', 'perm_user_force_pin', 'perm_user_block', 'perm_user_delete', 'perm_manage_roles',
        'perm_config_license', 'perm_menu_qr_config',
        'perm_config_db', 'perm_menu_smtp',
        'perm_audit_view', 'perm_view_all_login_logs',
        'perm_doc_manual', 'perm_doc_android', 'perm_doc_marketing', 'perm_doc_supabase'
      ]
    );
  END IF;

  -- 6 : Responsable Logistique 🚚
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE id::text = '6') THEN
    INSERT INTO public.roles (id, name, permissions)
    VALUES (
      6,
      'Responsable Logistique 🚚',
      ARRAY[
        'perm_tab_dashboard', 'perm_tab_inventory', 'perm_btn_center_show', 'perm_tab_movements', 'perm_tab_plus',
        'perm_header_notifications', 'perm_header_sync_details', 'perm_header_language_switch', 'perm_header_theme_toggle', 'perm_header_app_info', 'perm_header_logout',
        'perm_mov_out', 'perm_stock_in', 'perm_action_create_prod', 'perm_stock_transfer',
        'perm_dash_kpi', 'perm_dash_finance', 'perm_dash_kpi_all', 'perm_kpi_filter_depot', 'perm_dep_view',
        'perm_prod_view', 'perm_prod_view_price', 'perm_inv_btn_scan', 'perm_menu_print_labels', 'perm_menu_inventory_audit', 'perm_inventory_validate', 'perm_prod_edit', 'perm_prod_movement_direct', 'perm_prod_batch_cart', 'perm_inv_filters',
        'perm_mov_tabs', 'perm_mov_view_all', 'perm_mov_view_depot', 'perm_mov_tab_my', 'perm_mov_tab_proj', 'perm_mov_filter_dep', 'perm_mov_export_csv',
        'perm_create_order', 'perm_menu_order_prep', 'perm_order_assign', 'perm_order_mark_ready', 'perm_order_mark_collected', 'perm_order_cancel',
        'perm_manage_categories', 'perm_manage_depots', 'perm_depot_create', 'perm_depot_toggle_status', 'perm_depot_delete',
        'perm_report_view', 'perm_config_email', 'perm_email_manual_send',
        'perm_menu_profile', 'perm_menu_language', 'perm_doc_manual'
      ]
    );
  END IF;

  -- 7 : Responsable Magasin 📋
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE id::text = '7') THEN
    INSERT INTO public.roles (id, name, permissions)
    VALUES (
      7,
      'Responsable Magasin 📋',
      ARRAY[
        'perm_tab_dashboard', 'perm_tab_inventory', 'perm_btn_center_show', 'perm_tab_movements', 'perm_tab_plus',
        'perm_header_notifications', 'perm_header_sync_details', 'perm_header_language_switch', 'perm_header_theme_toggle', 'perm_header_app_info', 'perm_header_logout',
        'perm_mov_out', 'perm_stock_in', 'perm_action_create_prod', 'perm_stock_transfer',
        'perm_dash_kpi', 'perm_dash_finance', 'perm_kpi_filter_depot',
        'perm_prod_view', 'perm_prod_view_price', 'perm_inv_btn_scan', 'perm_menu_print_labels', 'perm_menu_inventory_audit', 'perm_inventory_validate', 'perm_prod_edit', 'perm_prod_movement_direct', 'perm_prod_batch_cart', 'perm_inv_filters',
        'perm_mov_tabs', 'perm_mov_view_depot', 'perm_mov_filter_dep', 'perm_mov_export_csv',
        'perm_create_order', 'perm_menu_order_prep', 'perm_order_assign', 'perm_order_mark_ready', 'perm_order_mark_collected', 'perm_order_cancel',
        'perm_manage_categories', 'perm_report_view',
        'perm_menu_profile', 'perm_menu_language', 'perm_doc_manual'
      ]
    );
  END IF;

  -- 8 : Responsable de Département 📁
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE id::text = '8') THEN
    INSERT INTO public.roles (id, name, permissions)
    VALUES (
      8,
      'Responsable de Département 📁',
      ARRAY[
        'perm_tab_dashboard', 'perm_tab_inventory', 'perm_tab_movements', 'perm_tab_plus',
        'perm_header_notifications', 'perm_header_sync_details', 'perm_header_language_switch', 'perm_header_theme_toggle', 'perm_header_logout',
        'perm_dash_kpi', 'perm_dash_finance', 'perm_kpi_scope_department', 'perm_dep_view',
        'perm_prod_view', 'perm_prod_view_price', 'perm_inv_btn_scan', 'perm_inv_filters',
        'perm_create_order', 'perm_order_approve', 'perm_order_cancel',
        'perm_mov_tabs', 'perm_mov_tab_proj', 'perm_mov_filter_dep', 'perm_mov_export_csv',
        'perm_depproj_menu', 'perm_report_view',
        'perm_manage_users', 'perm_user_block', 'perm_user_force_pin',
        'perm_menu_profile', 'perm_menu_language', 'perm_doc_manual'
      ]
    );
  END IF;

  -- 9 : Intérimaire ⏱️
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE id::text = '9') THEN
    INSERT INTO public.roles (id, name, permissions)
    VALUES (
      9,
      'Intérimaire ⏱️',
      ARRAY[
        'perm_tab_inventory', 'perm_btn_center_show', 'perm_tab_movements', 'perm_tab_plus',
        'perm_header_sync_details', 'perm_header_language_switch', 'perm_header_theme_toggle', 'perm_header_logout',
        'perm_mov_out',
        'perm_prod_view', 'perm_inv_btn_scan', 'perm_inv_filters',
        'perm_mov_tabs', 'perm_mov_tab_my',
        'perm_menu_profile', 'perm_menu_language'
      ]
    );
  END IF;

  -- 10 : Consultation 🔍
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE id::text = '10') THEN
    INSERT INTO public.roles (id, name, permissions)
    VALUES (
      10,
      'Consultation 🔍',
      ARRAY[
        'perm_tab_dashboard', 'perm_tab_inventory', 'perm_tab_movements', 'perm_tab_plus',
        'perm_header_notifications', 'perm_header_sync_details', 'perm_header_language_switch', 'perm_header_theme_toggle', 'perm_header_logout',
        'perm_dash_kpi', 'perm_dash_finance', 'perm_dash_kpi_all', 'perm_kpi_scope_department', 'perm_kpi_scope_other', 'perm_kpi_filter_depot',
        'perm_prod_view', 'perm_prod_view_price', 'perm_inv_btn_scan', 'perm_inv_filters',
        'perm_mov_tabs', 'perm_mov_export_csv',
        'perm_report_view', 'perm_audit_view', 'perm_view_all_login_logs',
        'perm_menu_profile', 'perm_menu_language', 'perm_doc_manual'
      ]
    );
  END IF;
END $$;

-- =========================================================================
-- Alignement additif des permissions des rôles 1 à 4 (schéma de base : perm_stock_out)
-- avec la permission réellement testée par process_stock_movement (perm_mov_out).
-- Rejouable : n'ajoute la permission que si elle manque.
-- =========================================================================
UPDATE public.roles
SET permissions = array_append(permissions, 'perm_mov_out')
WHERE 'perm_stock_out' = ANY(permissions)
  AND NOT ('perm_mov_out' = ANY(permissions));

-- =========================================================================
-- Alignement additif et rejouable des rôles 0 à 4 sur src/data/initialData.ts
-- Ajoute uniquement les permissions manquantes sans retirer aucune permission existante.
-- =========================================================================
DO $$
DECLARE
  v_role RECORD;
  v_perm TEXT;
  v_updated_perms TEXT[];
BEGIN
  FOR v_role IN
    SELECT * FROM (
      VALUES
        (0::BIGINT, ARRAY[
          'perm_tab_dashboard', 'perm_tab_inventory', 'perm_btn_center_show', 'perm_tab_movements', 'perm_tab_plus',
          'perm_header_notifications', 'perm_header_sync_details', 'perm_header_license_badge', 'perm_header_language_switch', 'perm_header_theme_toggle', 'perm_header_app_info', 'perm_header_logout',
          'perm_mov_out', 'perm_stock_in', 'perm_action_create_prod', 'perm_stock_transfer',
          'perm_dash_kpi', 'perm_dash_finance', 'perm_dash_kpi_all', 'perm_kpi_scope_department', 'perm_kpi_scope_other', 'perm_kpi_scope_individual', 'perm_kpi_filter_depot', 'perm_dep_view',
          'perm_prod_view', 'perm_prod_view_price', 'perm_inv_btn_scan', 'perm_menu_print_labels', 'perm_menu_inventory_audit', 'perm_inventory_validate', 'perm_prod_edit', 'perm_prod_delete', 'perm_prod_movement_direct', 'perm_prod_batch_cart', 'perm_inv_filters',
          'perm_mov_tabs', 'perm_mov_view_all', 'perm_mov_view_depot', 'perm_mov_tab_my', 'perm_mov_tab_proj', 'perm_mov_filter_dep', 'perm_mov_export_csv', 'perm_mov_delete',
          'perm_create_order', 'perm_order_approve', 'perm_menu_order_prep', 'perm_order_assign', 'perm_order_mark_ready', 'perm_order_mark_collected', 'perm_order_cancel',
          'perm_menu_profile', 'perm_menu_language', 'perm_manage_currency',
          'perm_depproj_menu', 'perm_dep_edit', 'perm_dep_delete', 'perm_proj_edit', 'perm_proj_delete',
          'perm_config_email', 'perm_email_manual_send', 'perm_menu_smtp',
          'perm_manage_categories',
          'perm_manage_depots', 'perm_depot_create', 'perm_depot_toggle_status', 'perm_depot_delete',
          'perm_manage_users', 'perm_user_force_pin', 'perm_user_block', 'perm_user_delete', 'perm_view_all_login_logs', 'perm_audit_view', 'perm_report_view', 'perm_manage_roles',
          'perm_menu_qr_config', 'perm_config_db', 'perm_config_license',
          'perm_doc_manual', 'perm_doc_android', 'perm_doc_marketing', 'perm_doc_supabase'
        ]::TEXT[]),
        (1::BIGINT, ARRAY[
          'perm_tab_dashboard', 'perm_tab_inventory', 'perm_btn_center_show', 'perm_tab_movements', 'perm_tab_plus',
          'perm_header_notifications', 'perm_header_sync_details', 'perm_header_language_switch', 'perm_header_theme_toggle', 'perm_header_app_info', 'perm_header_logout',
          'perm_mov_out', 'perm_stock_in', 'perm_action_create_prod', 'perm_stock_transfer',
          'perm_dash_kpi', 'perm_dash_finance', 'perm_dash_kpi_all', 'perm_kpi_scope_department', 'perm_kpi_scope_other', 'perm_kpi_scope_individual', 'perm_kpi_filter_depot', 'perm_dep_view',
          'perm_prod_view', 'perm_prod_view_price', 'perm_inv_btn_scan', 'perm_menu_print_labels', 'perm_menu_inventory_audit', 'perm_inventory_validate', 'perm_prod_edit', 'perm_prod_delete', 'perm_prod_movement_direct', 'perm_prod_batch_cart', 'perm_inv_filters',
          'perm_mov_tabs', 'perm_mov_view_all', 'perm_mov_view_depot', 'perm_mov_tab_my', 'perm_mov_tab_proj', 'perm_mov_filter_dep', 'perm_mov_export_csv',
          'perm_create_order', 'perm_order_approve', 'perm_order_cancel',
          'perm_menu_profile', 'perm_menu_language', 'perm_manage_currency',
          'perm_depproj_menu', 'perm_dep_edit', 'perm_dep_delete', 'perm_proj_edit', 'perm_proj_delete',
          'perm_manage_categories',
          'perm_manage_depots', 'perm_depot_create', 'perm_depot_toggle_status', 'perm_depot_delete',
          'perm_report_view', 'perm_audit_view', 'perm_view_all_login_logs', 'perm_config_email', 'perm_email_manual_send',
          'perm_doc_manual'
        ]::TEXT[]),
        (2::BIGINT, ARRAY[
          'perm_tab_dashboard', 'perm_tab_inventory', 'perm_btn_center_show', 'perm_tab_movements', 'perm_tab_plus',
          'perm_header_notifications', 'perm_header_sync_details', 'perm_header_language_switch', 'perm_header_theme_toggle', 'perm_header_app_info', 'perm_header_logout',
          'perm_mov_out', 'perm_stock_in', 'perm_action_create_prod', 'perm_stock_transfer',
          'perm_dash_kpi', 'perm_kpi_filter_depot',
          'perm_prod_view', 'perm_inv_btn_scan', 'perm_menu_print_labels', 'perm_menu_inventory_audit', 'perm_prod_edit', 'perm_prod_movement_direct', 'perm_prod_batch_cart', 'perm_inv_filters',
          'perm_mov_tabs', 'perm_mov_view_depot', 'perm_mov_tab_my', 'perm_mov_filter_dep', 'perm_mov_export_csv',
          'perm_create_order', 'perm_menu_order_prep', 'perm_order_assign', 'perm_order_mark_ready', 'perm_order_mark_collected',
          'perm_menu_profile', 'perm_menu_language', 'perm_doc_manual'
        ]::TEXT[]),
        (3::BIGINT, ARRAY[
          'perm_tab_dashboard', 'perm_tab_inventory', 'perm_btn_center_show', 'perm_tab_movements', 'perm_tab_plus',
          'perm_header_notifications', 'perm_header_sync_details', 'perm_header_language_switch', 'perm_header_theme_toggle', 'perm_header_logout',
          'perm_mov_out', 'perm_dash_kpi', 'perm_kpi_filter_depot',
          'perm_prod_view', 'perm_inv_btn_scan', 'perm_inv_filters', 'perm_prod_batch_cart',
          'perm_menu_inventory_audit',
          'perm_create_order', 'perm_order_approve', 'perm_order_mark_collected',
          'perm_mov_tabs', 'perm_mov_tab_proj', 'perm_mov_tab_my',
          'perm_menu_profile', 'perm_menu_language', 'perm_doc_manual'
        ]::TEXT[]),
        (4::BIGINT, ARRAY[
          'perm_tab_inventory', 'perm_btn_center_show', 'perm_tab_movements', 'perm_tab_plus',
          'perm_header_sync_details', 'perm_header_language_switch', 'perm_header_theme_toggle', 'perm_header_logout',
          'perm_mov_out',
          'perm_prod_view', 'perm_inv_btn_scan', 'perm_inv_filters', 'perm_prod_batch_cart',
          'perm_menu_inventory_audit',
          'perm_create_order', 'perm_order_mark_collected',
          'perm_mov_tabs', 'perm_mov_tab_my',
          'perm_menu_profile', 'perm_menu_language', 'perm_doc_manual'
        ]::TEXT[])
    ) AS t(role_id, target_perms)
  LOOP
    SELECT COALESCE(permissions, '{}'::TEXT[])
    INTO v_updated_perms
    FROM public.roles
    WHERE id::text = v_role.role_id::text;

    IF FOUND THEN
      FOREACH v_perm IN ARRAY v_role.target_perms LOOP
        IF NOT (v_perm = ANY(v_updated_perms)) THEN
          v_updated_perms := array_append(v_updated_perms, v_perm);
        END IF;
      END LOOP;

      UPDATE public.roles
      SET permissions = v_updated_perms
      WHERE id::text = v_role.role_id::text
        AND permissions IS DISTINCT FROM v_updated_perms;
    END IF;
  END LOOP;
END $$;

