// Scripts SQL PostgreSQL pour Supabase
// Importés directement depuis les fichiers sources dans supabase-client/ via Vite ?raw

import script01 from '../../supabase-client/01_auth_link.sql?raw';
import script02 from '../../supabase-client/02_rls_hardening.sql?raw';
import script03 from '../../supabase-client/03_rpc_stock_and_orders.sql?raw';
import script04 from '../../supabase-client/04_mouvements_et_depots_vehicules.sql?raw';
import script05 from '../../supabase-client/05_rpc_admin_users.sql?raw';
import script06 from '../../supabase-client/06_install_additional_roles.sql?raw';
import script07 from '../../supabase-client/07_app_compat.sql?raw';
import script08 from '../../supabase-client/08_print_jobs.sql?raw';
import script09 from '../../supabase-client/09_core_prefixes.sql?raw';
import script10 from '../../supabase-client/10_drop_compat_views.sql?raw';
import script11 from '../../supabase-client/11_suite_tables.sql?raw';
import script12 from '../../supabase-client/12_user_preferences.sql?raw';
import script13 from '../../supabase-client/13_transfer_stock_batch.sql?raw';
import script14 from '../../supabase-client/14_mailing.sql?raw';
import scriptFixAudits from '../../supabase-client/fix_inventory_audits.sql?raw';
import schemaMaster from '../../supabase-client/schema_master_licenses.sql?raw';
import edgeFnSyncLicense from '../../supabase-client/generated/edge-functions/APP_TOT-Stock_licenses_sync-license/index.ts?raw';
import edgeFnAdminUsers from '../../supabase-client/generated/edge-functions/APP_TOT-Stock_admin-users/index.ts?raw';
import edgeFnSendReportEmail from '../../supabase-client/generated/edge-functions/APP_TOT-Stock_send-report-email/index.ts?raw';
import edgeFnMasterLicenses from '../../supabase-client/generated/edge-functions-master/APP_TOT-Stock_licenses/index.ts?raw';

export const SQL_SCRIPT_01_AUTH_LINK = script01;
export const SQL_SCRIPT_02_RLS_HARDENING = script02;
export const SQL_SCRIPT_03_RPC_STOCK_AND_ORDERS = script03;
export const SQL_SCRIPT_04_DEPOTS_VEHICULES = script04;
export const SQL_SCRIPT_05_RPC_ADMIN_USERS = script05;
export const SQL_SCRIPT_06_INSTALL_ADDITIONAL_ROLES = script06;
export const SQL_SCRIPT_07_APP_COMPAT = script07;
export const SQL_SCRIPT_08_PRINT_JOBS = script08;
export const SQL_SCRIPT_09_CORE_PREFIXES = script09;
export const SQL_SCRIPT_10_DROP_COMPAT_VIEWS = script10;
export const SQL_SCRIPT_11_SUITE_TABLES = script11;
export const SQL_SCRIPT_12_USER_PREFERENCES = script12;
export const SQL_SCRIPT_13_TRANSFER_STOCK_BATCH = script13;
export const SQL_SCRIPT_14_MAILING = script14;
export const SQL_SCRIPT_FIX_INVENTORY_AUDITS = scriptFixAudits;
export const SQL_MASTER_LICENSES_SCHEMA = schemaMaster;

export const EDGE_FN_BUNDLE_SYNC_LICENSE = edgeFnSyncLicense;
export const EDGE_FN_BUNDLE_ADMIN_USERS = edgeFnAdminUsers;
export const EDGE_FN_BUNDLE_SEND_REPORT_EMAIL = edgeFnSendReportEmail;
export const EDGE_FN_BUNDLE_MASTER_LICENSES = edgeFnMasterLicenses;

