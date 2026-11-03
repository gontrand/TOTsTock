// Scripts SQL PostgreSQL pour Supabase
// Importés directement depuis les fichiers sources dans supabase-client/ via Vite ?raw

import script01 from '../../supabase-client/01_auth_link.sql?raw';
import script02 from '../../supabase-client/02_rls_hardening.sql?raw';
import script03 from '../../supabase-client/03_rpc_stock_and_orders.sql?raw';
import script04 from '../../supabase-client/04_mouvements_et_depots_vehicules.sql?raw';
import script05 from '../../supabase-client/05_rpc_admin_users.sql?raw';
import script06 from '../../supabase-client/06_install_additional_roles.sql?raw';
import script07 from '../../supabase-client/07_app_compat.sql?raw';
import schemaMaster from '../../supabase-client/schema_master_licenses.sql?raw';

export const SQL_SCRIPT_01_AUTH_LINK = script01;
export const SQL_SCRIPT_02_RLS_HARDENING = script02;
export const SQL_SCRIPT_03_RPC_STOCK_AND_ORDERS = script03;
export const SQL_SCRIPT_04_DEPOTS_VEHICULES = script04;
export const SQL_SCRIPT_05_RPC_ADMIN_USERS = script05;
export const SQL_SCRIPT_06_INSTALL_ADDITIONAL_ROLES = script06;
export const SQL_SCRIPT_07_APP_COMPAT = script07;
export const SQL_MASTER_LICENSES_SCHEMA = schemaMaster;
