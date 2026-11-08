export const DEFAULT_KEY_ID = 'ed25519-2026-v2';
export const LEGACY_KEY_ID = 'ed25519-2025-v1';
export const DEFAULT_LEGACY_RETIRED_AT = '2026-01-01T00:00:00.000Z';
export const DEFAULT_PUBLIC_KEY_B64 = 'MCowBQYDK2VwAyEA9n369nlU8Fi6exT4nTAtcA/r7ym7OtRVhZbxxKwCbfw=';
export const LEGACY_PUBLIC_KEY_B64 = 'MCowBQYDK2VwAyEAEqb3vlPKty9AMvJEODxOX3YzZZS/xCcSWTYTkA20dZQ=';

export const TABLES = {
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
  mailAccounts: 'core_mail_accounts',
  mailSenders: 'core_mail_senders',
  mailLog: 'core_mail_log',
  passwordResets: 'core_password_resets',
  products: 'stk_products',
  categories: 'stk_categories',
  subCategories: 'stk_sub_categories',
  stockLevels: 'stk_stock_levels',
  depots: 'stk_depots',
  movements: 'stk_movements',
  materialOrders: 'stk_material_orders',
  materialOrderItems: 'stk_material_order_items',
  printJobs: 'stk_print_jobs',
  printStations: 'stk_print_stations',
  inventoryAudits: 'stk_inventory_audits',
  inventoryAuditItems: 'stk_inventory_audit_items',
  orderPreparationsLog: 'stk_order_preparations_log',
} as const;

export interface SupabaseEnvConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  serviceRoleKey: string;
}

/**
 * Lit SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY injectés automatiquement par Supabase
 * (avec repli sur les variables d'environnement existantes pour compatibilité).
 */
export function getSupabaseEnv(): SupabaseEnvConfig {
  const env = (globalThis as any).Deno?.env;
  const get = (k: string): string => (env && typeof env.get === 'function' ? env.get(k) || '' : '');

  const supabaseUrl =
    get('SUPABASE_URL') ||
    get('PUBLIC_SUPABASE_URL') ||
    '';
  const supabaseAnonKey =
    get('SUPABASE_ANON_KEY') ||
    get('PUBLIC_SUPABASE_ANON_KEY') ||
    '';
  const serviceRoleKey =
    get('SUPABASE_SERVICE_ROLE_KEY') ||
    get('TOT_STOCK-SERVICE_ROLE_KEY') ||
    get('TOT_STOCK_SERVICE_ROLE_KEY') ||
    '';

  return { supabaseUrl, supabaseAnonKey, serviceRoleKey };
}

export const CLIENT_EDGE_FUNCTIONS = {
  adminUsers: 'APP_TOT-Stock_admin-users',
  syncLicense: 'APP_TOT-Stock_licenses_sync-license',
  sendReportEmail: 'APP_TOT-Stock_send-report-email',
  passwordReset: 'APP_TOT-Stock_password-reset',
} as const;

export const MASTER_EDGE_FUNCTIONS = {
  licenses: 'APP_TOT-Stock_licenses',
} as const;

export const DEFAULT_MASTER_LICENSE_FUNCTION = MASTER_EDGE_FUNCTIONS.licenses;

export interface RuntimeAppConfig {
  currentKeyId: string;
  legacyKeyRemovedAt: string;
  licensePublicKeyB64: string;
  masterLicenseUrl: string;
  masterLicenseFunction: string;
  senderEmail: string;
  senderName: string;
}

/**
 * Lit la configuration depuis public.app_settings avec repli sur le code embarqué
 * et les variables d'environnement existantes (Zéro secret manuel requis).
 */
export async function readRuntimeConfig(supabaseAdmin: any): Promise<RuntimeAppConfig> {
  const env = (globalThis as any).Deno?.env;
  const get = (k: string): string => (env && typeof env.get === 'function' ? env.get(k) || '' : '');

  const settingsMap: Record<string, string> = {};
  try {
    const { data } = await supabaseAdmin
      .from(TABLES.appSettings)
      .select('key, value')
      .in('key', [
        'license_public_key',
        'license_key_id',
        'master_license_url',
        'master_license_function',
        'smtp_from',
        'smtp_from_name',
        'company_name',
      ]);

    if (Array.isArray(data)) {
      for (const row of data) {
        if (row?.key && typeof row.value === 'string' && row.value.trim()) {
          settingsMap[row.key] = row.value.trim();
        }
      }
    }
  } catch {
    // Repli silencieux sur les valeurs par défaut / variables d'environnement
  }

  return {
    currentKeyId:
      settingsMap['license_key_id'] ||
      get('TOT_STOCK-ED25519_KID') ||
      get('ED25519_KID') ||
      DEFAULT_KEY_ID,
    legacyKeyRemovedAt:
      get('LEGACY_KEY_RETIRED_AT') ||
      DEFAULT_LEGACY_RETIRED_AT,
    licensePublicKeyB64:
      settingsMap['license_public_key'] ||
      get('ED25519_PUBLIC_KEY_B64') ||
      DEFAULT_PUBLIC_KEY_B64,
    masterLicenseUrl:
      settingsMap['master_license_url'] ||
      get('MASTER_LICENSE_URL') ||
      get('VITE_MASTER_SUPABASE_URL') ||
      '',
    masterLicenseFunction:
      settingsMap['master_license_function'] ||
      get('MASTER_LICENSE_FUNCTION') ||
      DEFAULT_MASTER_LICENSE_FUNCTION,
    senderEmail:
      settingsMap['smtp_from'] ||
      get('BREVO_SENDER_EMAIL') ||
      'no-reply@tot-stock.pro',
    senderName:
      settingsMap['smtp_from_name'] ||
      settingsMap['company_name'] ||
      'TOT Stock Pro',
  };
}

export interface EmailSecretConfig {
  configured: boolean;
  apiKey: string | null;
  smtpPass: string | null;
  senderEmail: string;
  senderName: string;
}

/**
 * Lit le secret d'envoi d'e-mail depuis Supabase Vault via la RPC SQL SECURITY DEFINER
 * public.get_email_secret() (exécutable uniquement par service_role), avec repli sur
 * les variables d'environnement BREVO_API_KEY / SENDINBLUE_API_KEY.
 */
export async function readEmailSecretConfig(supabaseAdmin: any): Promise<EmailSecretConfig> {
  const env = (globalThis as any).Deno?.env;
  const get = (k: string): string => (env && typeof env.get === 'function' ? env.get(k) || '' : '');

  let vaultApiKey: string | null = null;
  let vaultSmtpPass: string | null = null;
  let dbSenderEmail: string | null = null;
  let dbSenderName: string | null = null;

  try {
    const { data, error } = await supabaseAdmin.rpc('get_email_secret');
    if (!error && data && typeof data === 'object') {
      if (typeof data.brevo_api_key === 'string' && data.brevo_api_key.trim()) {
        vaultApiKey = data.brevo_api_key.trim();
      }
      if (typeof data.smtp_pass === 'string' && data.smtp_pass.trim()) {
        vaultSmtpPass = data.smtp_pass.trim();
      }
      if (typeof data.sender_email === 'string' && data.sender_email.trim()) {
        dbSenderEmail = data.sender_email.trim();
      }
      if (typeof data.sender_name === 'string' && data.sender_name.trim()) {
        dbSenderName = data.sender_name.trim();
      }
    }
  } catch {
    // Repli sur variables d'environnement si la RPC n'est pas encore créée
  }

  const envApiKey = (get('BREVO_API_KEY') || get('SENDINBLUE_API_KEY') || '').trim() || null;
  const envSmtpPass = (get('SMTP_PASS') || get('SMTP_PASSWORD') || '').trim() || null;

  const finalApiKey = vaultApiKey || envApiKey;
  const finalSmtpPass = vaultSmtpPass || envSmtpPass;

  return {
    configured: Boolean(finalApiKey || finalSmtpPass),
    apiKey: finalApiKey,
    smtpPass: finalSmtpPass,
    senderEmail: dbSenderEmail || get('BREVO_SENDER_EMAIL') || 'no-reply@tot-stock.pro',
    senderName: dbSenderName || 'TOT Stock Pro',
  };
}
