/**
 * Nomenclature officielle des tables Supabase de la suite TOT (v42 — Schéma 2.0.0).
 * Permet à toutes les applications de la suite TOT (Stock, Habilitation, Report…)
 * de partager une seule et même base PostgreSQL / Supabase :
 *   - core_* : tables partagées entre toutes les applications de la suite TOT
 *   - stk_*  : tables propres à l'application TOT Stock
 *   - hab_*  : convention réservée pour TOT Habilitation
 *   - rpt_*  : convention réservée pour TOT Report
 */
export const TABLES = {
  // Tables partagées (core_)
  users: 'core_users',
  roles: 'core_roles',
  departments: 'core_departments',
  projects: 'core_projects',
  companySettings: 'core_company_settings',
  appSettings: 'core_app_settings',
  licenseConfig: 'core_license_config',
  appCompat: 'core_app_compat',
  auditLogs: 'core_audit_logs',
  loginLogs: 'core_login_logs',
  processedOperations: 'core_processed_operations',
  files: 'core_files',
  userPreferences: 'core_user_preferences',
  mailAccounts: 'core_mail_accounts',
  mailSenders: 'core_mail_senders',
  mailLog: 'core_mail_log',

  // Tables Stock (stk_)
  products: 'stk_products',
  categories: 'stk_categories',
  subCategories: 'stk_sub_categories',
  stockLevels: 'stk_stock_levels',
  depots: 'stk_depots',
  movements: 'stk_movements',
  stockMovements: 'stk_movements',
  materialOrders: 'stk_material_orders',
  materialOrderItems: 'stk_material_order_items',
  printJobs: 'stk_print_jobs',
  printStations: 'stk_print_stations',
  inventoryAudits: 'stk_inventory_audits',
  inventoryAuditItems: 'stk_inventory_audit_items',
  orderPreparationsLog: 'stk_order_preparations_log',
} as const;

export type TableKey = keyof typeof TABLES;
export type TableName = (typeof TABLES)[TableKey];

export const SUITE_APP_PREFIXES = {
  core: 'core_',
  stock: 'stk_',
  habilitation: 'hab_',
  report: 'rpt_',
  tools: 'tools_',
} as const;

export const CURRENT_SUITE_APP_CODE = 'stock' as const;
export const CURRENT_MAIL_APP_CODE = 'stk' as const;

export type SuiteMailAppCode = 'stk' | 'hab' | 'rpt' | 'tools';

export const SUITE_MAIL_APPLICATIONS: ReadonlyArray<{
  code: SuiteMailAppCode;
  name: string;
  defaultFromName: string;
  isCurrentApp: boolean;
}> = [
  {
    code: 'stk',
    name: 'TOT Stock',
    defaultFromName: 'TOT Stock — Magasin & Logistique',
    isCurrentApp: true,
  },
  {
    code: 'hab',
    name: 'TOT Habilitation',
    defaultFromName: 'TOT Habilitation — Conformité & Titres',
    isCurrentApp: false,
  },
  {
    code: 'rpt',
    name: 'TOT Report',
    defaultFromName: 'TOT Report — Rapports & Chantiers',
    isCurrentApp: false,
  },
  {
    code: 'tools',
    name: 'TOT Outils',
    defaultFromName: 'TOT Outils — Parc & Étalonnage',
    isCurrentApp: false,
  },
] as const;

/**
 * Correspondance entre anciens noms de tables (schéma <= 1.1.1) et nouveaux noms préfixés (schéma 2.0.0).
 * Utilisé uniquement pour la rétrocompatibilité de la file d'attente locale hors-ligne.
 */
export const LEGACY_TO_PREFIXED_TABLE_MAP: Readonly<Record<string, TableName>> = {
  users: TABLES.users,
  roles: TABLES.roles,
  departments: TABLES.departments,
  projects: TABLES.projects,
  company_settings: TABLES.companySettings,
  app_settings: TABLES.appSettings,
  license_config: TABLES.licenseConfig,
  app_compat: TABLES.appCompat,
  audit_logs: TABLES.auditLogs,
  login_logs: TABLES.loginLogs,
  processed_operations: TABLES.processedOperations,
  files: TABLES.files,
  products: TABLES.products,
  categories: TABLES.categories,
  sub_categories: TABLES.subCategories,
  stock_levels: TABLES.stockLevels,
  depots: TABLES.depots,
  stock_movements: TABLES.movements,
  movements: TABLES.movements,
  material_orders: TABLES.materialOrders,
  material_order_items: TABLES.materialOrderItems,
  print_jobs: TABLES.printJobs,
  print_stations: TABLES.printStations,
  inventory_audits: TABLES.inventoryAudits,
  inventory_audit_items: TABLES.inventoryAuditItems,
  order_preparations_log: TABLES.orderPreparationsLog,
};

export const PREFIXED_TO_LEGACY_TABLE_MAP: Readonly<Record<string, string>> = {
  [TABLES.users]: 'users',
  [TABLES.roles]: 'roles',
  [TABLES.departments]: 'departments',
  [TABLES.projects]: 'projects',
  [TABLES.companySettings]: 'company_settings',
  [TABLES.appSettings]: 'app_settings',
  [TABLES.licenseConfig]: 'license_config',
  [TABLES.appCompat]: 'app_compat',
  [TABLES.auditLogs]: 'audit_logs',
  [TABLES.loginLogs]: 'login_logs',
  [TABLES.processedOperations]: 'processed_operations',
  [TABLES.files]: 'files',
  [TABLES.products]: 'products',
  [TABLES.categories]: 'categories',
  [TABLES.subCategories]: 'sub_categories',
  [TABLES.stockLevels]: 'stock_levels',
  [TABLES.depots]: 'depots',
  [TABLES.movements]: 'stock_movements',
  [TABLES.materialOrders]: 'material_orders',
  [TABLES.materialOrderItems]: 'material_order_items',
  [TABLES.printJobs]: 'print_jobs',
  [TABLES.printStations]: 'print_stations',
  [TABLES.inventoryAudits]: 'inventory_audits',
  [TABLES.inventoryAuditItems]: 'inventory_audit_items',
  [TABLES.orderPreparationsLog]: 'order_preparations_log',
};

export function resolvePrefixedTableName(tableOrEntity: string): string {
  return LEGACY_TO_PREFIXED_TABLE_MAP[tableOrEntity] || tableOrEntity;
}
