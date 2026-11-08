// =========================================================================
// TOT STOCK — FONCTION EDGE AUTONOME (FICHIER UNIQUE COPIER-COLLER)
// Nom exact à créer dans Supabase : APP_TOT-Stock_password-reset
// Rôle : Réinitialisation du mot de passe par code à usage unique à 6 chiffres envoyé par e-mail
// Généré automatiquement par : scripts/build-edge.mjs (npm run build:sql)
// =========================================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: any;

// -------------------------------------------------------------------------
// Module inliné : _shared/cors.ts
// -------------------------------------------------------------------------
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}

export function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
// -------------------------------------------------------------------------
// Module inliné : _shared/config.ts
// -------------------------------------------------------------------------
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
// -------------------------------------------------------------------------
// Module inliné : _shared/auth.ts
// -------------------------------------------------------------------------
export interface AuthenticatedCallerContext {
  supabaseUrl: string;
  serviceRoleKey: string;
  supabaseAdmin: any;
  authCaller: { id: string; email?: string };
  callerProfile: {
    id: string;
    auth_user_id: string;
    name: string;
    email?: string;
    role_id: number;
    department?: string;
    allowed_depots?: string[];
    is_blocked: boolean;
  };
  callerPerms: string[];
  isSuperAdmin: boolean;
  hasUniversal: boolean;
}

/**
 * Authentifie l'appelant à partir de l'en-tête Authorization (JWT Supabase Auth),
 * vérifie que le profil existe dans public.users et n'est pas bloqué, et charge ses permissions.
 */
export async function authenticateCaller(
  req: Request
): Promise<{ ok: true; ctx: AuthenticatedCallerContext } | { ok: false; response: Response }> {
  const { supabaseUrl, supabaseAnonKey, serviceRoleKey } = getSupabaseEnv();

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false,
      response: jsonResponse(
        {
          success: false,
          error: 'Configuration serveur Supabase incomplète (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).',
        },
        500
      ),
    };
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return {
      ok: false,
      response: jsonResponse({ success: false, error: 'Authentification requise.' }, 401),
    };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey || serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
  const authCaller = authData?.user;
  if (authErr || !authCaller) {
    return {
      ok: false,
      response: jsonResponse({ success: false, error: 'Session utilisateur invalide ou expirée.' }, 401),
    };
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const { data: callerProfile, error: profErr } = await supabaseAdmin
    .from(TABLES.users)
    .select('id, auth_user_id, name, email, role_id, department, allowed_depots, is_blocked')
    .eq('auth_user_id', authCaller.id)
    .maybeSingle();

  if (profErr || !callerProfile) {
    return {
      ok: false,
      response: jsonResponse({ success: false, error: 'Profil utilisateur introuvable.' }, 403),
    };
  }

  if (callerProfile.is_blocked) {
    return {
      ok: false,
      response: jsonResponse({ success: false, error: 'Compte utilisateur verrouillé.' }, 403),
    };
  }

  const { data: callerRole } = await supabaseAdmin
    .from(TABLES.roles)
    .select('id, name, permissions')
    .eq('id', callerProfile.role_id)
    .maybeSingle();

  const isSuperAdmin = Number(callerProfile.role_id) === 0;
  const callerPerms: string[] = Array.isArray(callerRole?.permissions) ? callerRole.permissions : [];
  const hasUniversal = isSuperAdmin || callerPerms.includes('*');

  return {
    ok: true,
    ctx: {
      supabaseUrl,
      serviceRoleKey,
      supabaseAdmin,
      authCaller: { id: authCaller.id, email: authCaller.email },
      callerProfile: {
        id: String(callerProfile.id),
        auth_user_id: String(callerProfile.auth_user_id),
        name: String(callerProfile.name || ''),
        email: callerProfile.email ? String(callerProfile.email) : undefined,
        role_id: Number(callerProfile.role_id),
        department: callerProfile.department ? String(callerProfile.department) : undefined,
        allowed_depots: Array.isArray(callerProfile.allowed_depots) ? callerProfile.allowed_depots : [],
        is_blocked: Boolean(callerProfile.is_blocked),
      },
      callerPerms,
      isSuperAdmin,
      hasUniversal,
    },
  };
}
// -------------------------------------------------------------------------
// Module inliné : _shared/mailProviders.ts
// -------------------------------------------------------------------------
export type MailProviderType =
  | 'brevo'
  | 'resend'
  | 'sendgrid'
  | 'mailgun'
  | 'postmark'
  | 'mailjet'
  | 'smtp'
  | 'msgraph';

export type SmtpEncryptionType = 'ssl' | 'starttls' | 'none';

export const MSGRAPH_MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024; // 3 Mo max en v1
export const MSGRAPH_MAX_TOKEN_CACHE_MS = 50 * 60 * 1000; // <= 50 minutes

export interface ResolvedMailConfig {
  configured: boolean;
  legacy?: boolean;
  reason?: string;
  config_error?: string;
  account_id?: string | null;
  account_name?: string | null;
  provider?: MailProviderType;
  preset?: string | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_encryption?: SmtpEncryptionType | null;
  smtp_username?: string | null;
  host?: string | null;
  port?: number | null;
  encryption?: SmtpEncryptionType | null;
  username?: string | null;
  secret?: string | null;
  extra?: Record<string, any> | null;
  app_code?: string;
  from_name?: string;
  from_email?: string;
  reply_to?: string | null;
}

export interface MailAttachmentInput {
  filename: string;
  contentBase64: string;
  contentType?: string;
}

export interface MailDispatchMessage {
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
  to: string[];
  subject: string;
  htmlContent: string;
  attachments?: MailAttachmentInput[];
}

export interface MailProviderResult {
  ok: boolean;
  provider: MailProviderType;
  messageId?: string;
  statusCode?: number;
  retryAfterSeconds?: number;
  error?: string;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type SmtpTransportFn = (
  config: ResolvedMailConfig,
  message: MailDispatchMessage
) => Promise<{ ok: boolean; messageId?: string; error?: string }>;

interface MsGraphCachedToken {
  accessToken: string;
  expiresAt: number;
}

const msGraphTokenCache = new Map<string, MsGraphCachedToken>();

export function clearMsGraphTokenCache(): void {
  msGraphTokenCache.clear();
}

/**
 * Masque une adresse e-mail pour le journal RGPD : "jean.dupont@domaine.fr" -> "j***@domaine.fr"
 */
export function maskEmailRecipient(email: string): string {
  const trimmed = String(email || '').trim().toLowerCase();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return '***@***';
  }
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  return `${local[0]}***@${domain}`;
}

export function maskEmailRecipientList(recipients: string[]): string {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return '***@***';
  }
  const first = maskEmailRecipient(recipients[0]);
  if (recipients.length === 1) return first;
  return `${first} (+${recipients.length - 1})`;
}

export function redactSecretsFromText(
  rawText: string,
  secretsToRedact?: Array<string | null | undefined>
): string {
  let msg = String(rawText || '');
  if (Array.isArray(secretsToRedact)) {
    for (const sec of secretsToRedact) {
      if (sec && sec.trim().length >= 4) {
        const escaped = sec.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        msg = msg.replace(new RegExp(escaped, 'g'), '[SECRET_MASQUÉ]');
      }
    }
  }
  msg = msg
    .replace(/xkeysib-[a-zA-Z0-9_-]+/gi, '[SECRET_MASQUÉ]')
    .replace(/\bre_[a-zA-Z0-9_-]{8,}/g, '[SECRET_MASQUÉ]')
    .replace(/\bSG\.[a-zA-Z0-9_.-]{10,}/g, '[SECRET_MASQUÉ]')
    .replace(/Bearer\s+[a-zA-Z0-9_~+/=-]{12,}/gi, 'Bearer [SECRET_MASQUÉ]');
  return msg;
}

/**
 * Normalise en français les erreurs spécifiques à Microsoft 365 (Graph) sans jamais exposer le secret ni le jeton.
 */
export function normalizeMsGraphError(
  rawError: unknown,
  statusCode?: number,
  extraContext?: {
    errorCode?: string;
    fromEmail?: string;
    retryAfter?: string | null;
    secretsToRedact?: Array<string | null | undefined>;
  }
): string {
  const rawStr =
    typeof rawError === 'string'
      ? rawError
      : rawError && typeof (rawError as any).message === 'string'
      ? (rawError as any).message
      : 'Erreur Microsoft 365 (Graph)';

  const msg = redactSecretsFromText(rawStr, extraContext?.secretsToRedact);
  const code = redactSecretsFromText(String(extraContext?.errorCode || ''), extraContext?.secretsToRedact);
  const combinedLower = `${code} ${msg}`.toLowerCase();
  const mailboxHint = extraContext?.fromEmail ? ` (${extraContext.fromEmail})` : '';

  if (
    statusCode === 401 ||
    combinedLower.includes('invalid_client') ||
    combinedLower.includes('aadsts7000215') ||
    combinedLower.includes('aadsts7000222') ||
    combinedLower.includes('invalidauthenticationtoken') ||
    combinedLower.includes('unauthorized')
  ) {
    return "Authentification Microsoft 365 (Graph) refusée : secret expiré ou incorrect (vérifiez la valeur du secret client Entra ID et sa date d'expiration).";
  }

  if (
    statusCode === 403 ||
    combinedLower.includes('erroraccessdenied') ||
    combinedLower.includes('accessdenied') ||
    combinedLower.includes('authorization_requestdenied') ||
    combinedLower.includes('insufficient privileges')
  ) {
    return `Accès refusé par Microsoft 365 (Graph) : consentement administrateur manquant ou boîte non autorisée par la stratégie d'accès de l'application${mailboxHint}.`;
  }

  if (
    statusCode === 404 ||
    combinedLower.includes('errorinvaliduser') ||
    combinedLower.includes('resourcenotfound') ||
    combinedLower.includes('request_resourcenotfound') ||
    combinedLower.includes('mailboxnotenabledforrestapi') ||
    combinedLower.includes('errornonexistentmailbox')
  ) {
    return `Envoi Microsoft 365 (Graph) impossible : boîte aux lettres introuvable dans ce tenant${mailboxHint}.`;
  }

  if (statusCode === 429 || combinedLower.includes('too many requests') || combinedLower.includes('throttled')) {
    const retrySec = extraContext?.retryAfter ? String(extraContext.retryAfter).trim() : '';
    return retrySec
      ? `Envoi Microsoft 365 (Graph) suspendu (HTTP 429) : limite de débit Microsoft atteinte, veuillez réessayer après ${retrySec} s (Retry-After).`
      : 'Envoi Microsoft 365 (Graph) suspendu (HTTP 429) : limite de débit Microsoft atteinte, réessayez plus tard.';
  }

  if (combinedLower.includes('aadsts700016') || combinedLower.includes('unauthorized_client')) {
    return "Application Microsoft 365 (Graph) introuvable dans ce tenant : vérifiez le Tenant ID et le Client ID (Application ID).";
  }

  if (combinedLower.includes('aadsts90002')) {
    return "Tenant Microsoft 365 introuvable : vérifiez l'identifiant du tenant (GUID ou domaine).";
  }

  return `Échec Microsoft 365 (Graph)${statusCode ? ` (HTTP ${statusCode})` : ''} : ${msg}`;
}

/**
 * Supprime toute occurrence accidentelle d'un secret ou jeton dans un message d'erreur
 * et traduit les erreurs techniques courantes en français clair.
 */
export function sanitizeAndTranslateMailError(
  rawError: unknown,
  statusCode?: number,
  provider?: string,
  secretToRedact?: string | null
): string {
  const rawStr =
    typeof rawError === 'string'
      ? rawError
      : rawError && typeof (rawError as any).message === 'string'
      ? (rawError as any).message
      : 'Erreur lors de la communication avec le service e-mail.';

  const msg = redactSecretsFromText(rawStr, [secretToRedact]);

  if (provider === 'msgraph') {
    if (
      msg.startsWith('Authentification Microsoft 365 (Graph)') ||
      msg.startsWith('Accès refusé par Microsoft 365 (Graph)') ||
      msg.startsWith('Envoi Microsoft 365 (Graph) impossible') ||
      msg.startsWith('Limitation Microsoft 365 (Graph)') ||
      msg.startsWith('La taille totale des pièces jointes dépasse la limite de 3 Mo')
    ) {
      return msg;
    }
    return normalizeMsGraphError(msg, statusCode, { secretsToRedact: [secretToRedact] });
  }

  const lower = msg.toLowerCase();
  const label = provider ? provider.toUpperCase() : 'Fournisseur';

  if (
    statusCode === 401 ||
    statusCode === 403 ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key') ||
    lower.includes('authentication failed') ||
    lower.includes('535 ')
  ) {
    return `Authentification refusée par ${label} : clé API ou mot de passe d'application invalide.`;
  }
  if (
    statusCode === 429 ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('quota')
  ) {
    return `Limite d'envoi ou quota dépassé chez ${label}. Réessayez plus tard.`;
  }
  if (
    statusCode === 422 ||
    lower.includes('sender') ||
    lower.includes('from address') ||
    lower.includes('not verified') ||
    lower.includes('domain is not verified')
  ) {
    return `Adresse d'expéditeur refusée par ${label} : vérifiez que l'adresse et son domaine sont validés chez le fournisseur (${msg}).`;
  }
  if (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound')
  ) {
    return `Impossible de joindre le serveur ${label} (délai dépassé ou hôte inaccessible).`;
  }

  return `Échec d'envoi ${label}${statusCode ? ` (HTTP ${statusCode})` : ''} : ${msg}`;
}

function encodeBase64Ascii(value: string): string {
  if (typeof btoa === 'function') {
    return btoa(value);
  }
  const B = (globalThis as any).Buffer;
  if (B) {
    return B.from(value, 'utf8').toString('base64');
  }
  throw new Error('Encodage Base64 indisponible');
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return encodeBase64Ascii(binary);
}

export function estimateAttachmentsBytes(attachments?: MailAttachmentInput[]): number {
  if (!Array.isArray(attachments) || attachments.length === 0) return 0;
  let total = 0;
  for (const att of attachments) {
    const b64 = String(att?.contentBase64 || '').trim().replace(/\s+/g, '');
    if (!b64) continue;
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    total += Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
  }
  return total;
}

/**
 * Client SMTP minimaliste autonome pour Deno Edge Functions (SSL/TLS port 465 ou STARTTLS port 587).
 * Refuse explicitement le port 25 (bloqué dans les environnements cloud / Supabase Edge).
 */
export async function sendSmtpNativeDeno(
  config: ResolvedMailConfig,
  message: MailDispatchMessage
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const host = String(config.smtp_host || config.host || '').trim();
  const port = Number(config.smtp_port || config.port || 587);
  const encryption: SmtpEncryptionType =
    ((config.smtp_encryption || config.encryption) as SmtpEncryptionType) ||
    (port === 465 ? 'ssl' : 'starttls');
  const username = String(config.smtp_username || config.username || '').trim();
  const secret = String(config.secret || '');

  if (!host) {
    return { ok: false, error: 'Hôte SMTP manquant dans la configuration du compte.' };
  }
  if (port === 25) {
    return {
      ok: false,
      error:
        "Port SMTP 25 non pris en charge par l'environnement Edge Functions (bloqué contre le spam). Utilisez le port 587 (STARTTLS) ou 465 (SSL/TLS).",
    };
  }

  const denoObj = (globalThis as any).Deno;
  if (!denoObj || typeof denoObj.connect !== 'function') {
    return {
      ok: false,
      error: "Connexion TCP/SMTP directe indisponible dans cet environnement d'exécution.",
    };
  }

  let conn: any = null;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const readLine = async (c: any): Promise<string> => {
    const buf = new Uint8Array(4096);
    let accumulated = '';
    while (true) {
      const n = await c.read(buf);
      if (n === null) break;
      accumulated += decoder.decode(buf.subarray(0, n));
      const lines = accumulated.split('\r\n').filter(Boolean);
      const lastLine = lines[lines.length - 1] || '';
      if (/^\d{3} /.test(lastLine)) {
        return accumulated;
      }
    }
    return accumulated;
  };

  const sendCmd = async (c: any, cmd: string, expectedPrefix = '2'): Promise<string> => {
    await c.write(encoder.encode(`${cmd}\r\n`));
    const resp = await readLine(c);
    if (!resp.startsWith(expectedPrefix)) {
      throw new Error(`Réponse SMTP inattendue (${resp.trim()})`);
    }
    return resp;
  };

  try {
    if (encryption === 'ssl') {
      conn = await denoObj.connectTls({ hostname: host, port });
    } else {
      conn = await denoObj.connect({ hostname: host, port });
    }

    const banner = await readLine(conn);
    if (!banner.startsWith('220')) {
      throw new Error(`Bannière SMTP invalide : ${banner.trim()}`);
    }

    await sendCmd(conn, `EHLO tot-stock.local`, '250');

    if (encryption === 'starttls') {
      await sendCmd(conn, 'STARTTLS', '220');
      if (typeof denoObj.startTls !== 'function') {
        throw new Error('Deno.startTls non supporté dans ce runtime ; privilégiez SSL/TLS sur le port 465.');
      }
      conn = await denoObj.startTls(conn, { hostname: host });
      await sendCmd(conn, `EHLO tot-stock.local`, '250');
    }

    if (username) {
      await sendCmd(conn, 'AUTH LOGIN', '334');
      await sendCmd(conn, encodeBase64Ascii(username), '334');
      await sendCmd(conn, encodeBase64Ascii(secret), '235');
    }

    await sendCmd(conn, `MAIL FROM:<${message.fromEmail}>`, '250');
    for (const rcpt of message.to) {
      await sendCmd(conn, `RCPT TO:<${rcpt}>`, '250');
    }

    await sendCmd(conn, 'DATA', '354');

    const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2, 10)}@${
      message.fromEmail.split('@')[1] || 'tot-stock.local'
    }>`;
    const encodedSubject = `=?UTF-8?B?${encodeBase64Utf8(message.subject)}?=`;
    const encodedFromName = `=?UTF-8?B?${encodeBase64Utf8(message.fromName)}?=`;

    const headers = [
      `Message-ID: ${msgId}`,
      `Date: ${new Date().toUTCString()}`,
      `From: ${encodedFromName} <${message.fromEmail}>`,
      `To: ${message.to.join(', ')}`,
      ...(message.replyTo ? [`Reply-To: ${message.replyTo}`] : []),
      `Subject: ${encodedSubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
    ];

    const bodyBase64 = encodeBase64Utf8(message.htmlContent).replace(/(.{76})/g, '$1\r\n');
    const mimePayload = `${headers.join('\r\n')}\r\n\r\n${bodyBase64}\r\n.`;

    await sendCmd(conn, mimePayload, '250');
    try {
      await sendCmd(conn, 'QUIT', '221');
    } catch {
      // Ignorer la fermeture
    }
    try {
      conn.close();
    } catch {
      // Ignorer
    }

    return { ok: true, messageId: msgId };
  } catch (err: any) {
    if (conn) {
      try {
        conn.close();
      } catch {
        // Ignorer
      }
    }
    return {
      ok: false,
      error: sanitizeAndTranslateMailError(err, undefined, 'smtp', secret),
    };
  }
}

/**
 * Envoie un e-mail via le fournisseur configuré dans `core_mail_accounts`.
 */
export async function sendMailWithProvider(
  config: ResolvedMailConfig,
  message: MailDispatchMessage,
  customFetch: FetchLike = fetch,
  customSmtpSend?: SmtpTransportFn
): Promise<MailProviderResult> {
  const provider: MailProviderType = (config.provider || 'brevo') as MailProviderType;
  const secret = String(config.secret || '').trim();

  if (!secret) {
    return {
      ok: false,
      provider,
      error: 'Aucun secret (clé API ou mot de passe SMTP) configuré pour ce compte.',
    };
  }

  try {
    switch (provider) {
      case 'brevo': {
        const payload: Record<string, any> = {
          sender: {
            name: message.fromName,
            email: message.fromEmail,
          },
          to: message.to.map((email) => ({ email })),
          subject: message.subject,
          htmlContent: message.htmlContent,
        };
        if (message.replyTo) {
          payload.replyTo = { email: message.replyTo };
        }
        if (Array.isArray(message.attachments) && message.attachments.length > 0) {
          payload.attachment = message.attachments.map((att) => ({
            name: att.filename,
            content: att.contentBase64,
          }));
        }

        const resp = await customFetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'api-key': secret,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        const data: any = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          return {
            ok: false,
            provider,
            statusCode: resp.status,
            error: sanitizeAndTranslateMailError(
              data?.message || data?.error || `HTTP ${resp.status}`,
              resp.status,
              'brevo',
              secret
            ),
          };
        }
        return {
          ok: true,
          provider,
          statusCode: resp.status,
          messageId: data?.messageId || data?.id || 'brevo-ok',
        };
      }

      case 'resend': {
        const payload: Record<string, any> = {
          from: `${message.fromName} <${message.fromEmail}>`,
          to: message.to,
          subject: message.subject,
          html: message.htmlContent,
        };
        if (message.replyTo) {
          payload.reply_to = message.replyTo;
        }
        if (Array.isArray(message.attachments) && message.attachments.length > 0) {
          payload.attachments = message.attachments.map((att) => ({
            filename: att.filename,
            content: att.contentBase64,
          }));
        }

        const resp = await customFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        const data: any = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          return {
            ok: false,
            provider,
            statusCode: resp.status,
            error: sanitizeAndTranslateMailError(
              data?.message || data?.error?.message || `HTTP ${resp.status}`,
              resp.status,
              'resend',
              secret
            ),
          };
        }
        return {
          ok: true,
          provider,
          statusCode: resp.status,
          messageId: data?.id || 'resend-ok',
        };
      }

      case 'sendgrid': {
        const payload: Record<string, any> = {
          personalizations: [
            {
              to: message.to.map((email) => ({ email })),
            },
          ],
          from: {
            email: message.fromEmail,
            name: message.fromName,
          },
          subject: message.subject,
          content: [
            {
              type: 'text/html',
              value: message.htmlContent,
            },
          ],
        };
        if (message.replyTo) {
          payload.reply_to = { email: message.replyTo };
        }
        if (Array.isArray(message.attachments) && message.attachments.length > 0) {
          payload.attachments = message.attachments.map((att) => ({
            filename: att.filename,
            content: att.contentBase64,
            type: att.contentType || 'application/octet-stream',
            disposition: 'attachment',
          }));
        }

        const resp = await customFetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          const data: any = await resp.json().catch(() => ({}));
          const errDetail =
            data?.errors?.[0]?.message || data?.message || `HTTP ${resp.status}`;
          return {
            ok: false,
            provider,
            statusCode: resp.status,
            error: sanitizeAndTranslateMailError(errDetail, resp.status, 'sendgrid', secret),
          };
        }
        const msgId =
          resp.headers?.get?.('x-message-id') || 'sendgrid-accepted';
        return {
          ok: true,
          provider,
          statusCode: resp.status,
          messageId: msgId,
        };
      }

      case 'mailgun': {
        const extra = config.extra && typeof config.extra === 'object' ? config.extra : {};
        const domain = String(
          extra.domain || config.host || message.fromEmail.split('@')[1] || ''
        ).trim();
        const region = String(extra.region || 'eu').toLowerCase() === 'us' ? 'us' : 'eu';
        if (!domain) {
          return {
            ok: false,
            provider,
            error: "Domaine d'envoi Mailgun manquant dans la configuration du compte.",
          };
        }
        const baseUrl =
          region === 'eu'
            ? `https://api.eu.mailgun.net/v3/${encodeURIComponent(domain)}/messages`
            : `https://api.mailgun.net/v3/${encodeURIComponent(domain)}/messages`;

        const formParams = new URLSearchParams();
        formParams.set('from', `${message.fromName} <${message.fromEmail}>`);
        for (const rcpt of message.to) {
          formParams.append('to', rcpt);
        }
        formParams.set('subject', message.subject);
        formParams.set('html', message.htmlContent);
        if (message.replyTo) {
          formParams.set('h:Reply-To', message.replyTo);
        }

        const authHeader = `Basic ${encodeBase64Ascii(`api:${secret}`)}`;
        const resp = await customFetch(baseUrl, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formParams.toString(),
        });
        const data: any = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          return {
            ok: false,
            provider,
            statusCode: resp.status,
            error: sanitizeAndTranslateMailError(
              data?.message || `HTTP ${resp.status}`,
              resp.status,
              'mailgun',
              secret
            ),
          };
        }
        return {
          ok: true,
          provider,
          statusCode: resp.status,
          messageId: data?.id || 'mailgun-ok',
        };
      }

      case 'postmark': {
        const payload: Record<string, any> = {
          From: `${message.fromName} <${message.fromEmail}>`,
          To: message.to.join(','),
          Subject: message.subject,
          HtmlBody: message.htmlContent,
          MessageStream: (config.extra && config.extra.messageStream) || 'outbound',
        };
        if (message.replyTo) {
          payload.ReplyTo = message.replyTo;
        }
        if (Array.isArray(message.attachments) && message.attachments.length > 0) {
          payload.Attachments = message.attachments.map((att) => ({
            Name: att.filename,
            Content: att.contentBase64,
            ContentType: att.contentType || 'application/octet-stream',
          }));
        }

        const resp = await customFetch('https://api.postmarkapp.com/email', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Postmark-Server-Token': secret,
          },
          body: JSON.stringify(payload),
        });
        const data: any = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          return {
            ok: false,
            provider,
            statusCode: resp.status,
            error: sanitizeAndTranslateMailError(
              data?.Message || `HTTP ${resp.status}`,
              resp.status,
              'postmark',
              secret
            ),
          };
        }
        return {
          ok: true,
          provider,
          statusCode: resp.status,
          messageId: data?.MessageID || 'postmark-ok',
        };
      }

      case 'mailjet': {
        const apiKeyPublic = String(
          config.smtp_username || config.username || (config.extra && config.extra.apiKeyPublic) || ''
        ).trim();
        if (!apiKeyPublic) {
          return {
            ok: false,
            provider,
            error: "Clé API publique Mailjet (identifiant) manquante dans la configuration du compte.",
          };
        }
        const msgObj: Record<string, any> = {
          From: {
            Email: message.fromEmail,
            Name: message.fromName,
          },
          To: message.to.map((Email) => ({ Email })),
          Subject: message.subject,
          HTMLPart: message.htmlContent,
        };
        if (message.replyTo) {
          msgObj.ReplyTo = { Email: message.replyTo };
        }
        if (Array.isArray(message.attachments) && message.attachments.length > 0) {
          msgObj.Attachments = message.attachments.map((att) => ({
            Filename: att.filename,
            Base64Content: att.contentBase64,
            ContentType: att.contentType || 'application/octet-stream',
          }));
        }

        const authHeader = `Basic ${encodeBase64Ascii(`${apiKeyPublic}:${secret}`)}`;
        const resp = await customFetch('https://api.mailjet.com/v3.1/send', {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ Messages: [msgObj] }),
        });
        const data: any = await resp.json().catch(() => ({}));
        const firstStatus = data?.Messages?.[0]?.Status;
        if (!resp.ok || firstStatus === 'error') {
          const errMsg =
            data?.Messages?.[0]?.Errors?.[0]?.ErrorMessage ||
            data?.ErrorMessage ||
            `HTTP ${resp.status}`;
          return {
            ok: false,
            provider,
            statusCode: resp.status,
            error: sanitizeAndTranslateMailError(errMsg, resp.status, 'mailjet', secret),
          };
        }
        return {
          ok: true,
          provider,
          statusCode: resp.status,
          messageId:
            String(data?.Messages?.[0]?.To?.[0]?.MessageUUID || '') || 'mailjet-ok',
        };
      }

      case 'msgraph': {
        const extra = config.extra && typeof config.extra === 'object' ? config.extra : {};
        const tenantId = String(extra.tenant_id || '').trim();
        const clientId = String(extra.client_id || '').trim();

        if (!tenantId || !clientId) {
          return {
            ok: false,
            provider: 'msgraph',
            statusCode: 400,
            error:
              "Configuration Microsoft 365 (Graph) incomplète : les champs Tenant ID et Client ID sont obligatoires.",
          };
        }

        const totalAttBytes = estimateAttachmentsBytes(message.attachments);
        if (totalAttBytes > MSGRAPH_MAX_ATTACHMENT_BYTES) {
          return {
            ok: false,
            provider: 'msgraph',
            statusCode: 400,
            error:
              "La taille totale des pièces jointes dépasse la limite de 3 Mo autorisée par Microsoft 365 (Graph) en envoi direct.",
          };
        }

        const cacheKey = `${tenantId.toLowerCase()}::${clientId.toLowerCase()}::${secret.slice(0, 4)}_${secret.length}`;
        const now = Date.now();
        let accessToken = '';
        const cached = msGraphTokenCache.get(cacheKey);

        if (cached && cached.expiresAt > now && cached.accessToken) {
          accessToken = cached.accessToken;
        } else {
          const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
            tenantId
          )}/oauth2/v2.0/token`;
          const tokenForm = new URLSearchParams();
          tokenForm.set('client_id', clientId);
          tokenForm.set('client_secret', secret);
          tokenForm.set('scope', 'https://graph.microsoft.com/.default');
          tokenForm.set('grant_type', 'client_credentials');

          const tokenResp = await customFetch(tokenUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: tokenForm.toString(),
          });

          const tokenData: any = await tokenResp.json().catch(() => ({}));
          if (!tokenResp.ok || !tokenData?.access_token) {
            const oauthErrCode = String(tokenData?.error || '');
            const oauthErrDesc = String(
              tokenData?.error_description || tokenData?.error || `HTTP ${tokenResp.status}`
            );
            const effectiveStatus =
              oauthErrCode === 'invalid_client' || oauthErrDesc.includes('AADSTS7000215')
                ? 401
                : tokenResp.status || 401;
            return {
              ok: false,
              provider: 'msgraph',
              statusCode: effectiveStatus,
              error: normalizeMsGraphError(oauthErrDesc, effectiveStatus, {
                errorCode: oauthErrCode,
                fromEmail: message.fromEmail,
                secretsToRedact: [secret],
              }),
            };
          }

          accessToken = String(tokenData.access_token);
          const expiresInSec = Number(tokenData.expires_in || 3600);
          const safeTtlMs = Math.min(
            Math.max(60, expiresInSec - 300) * 1000,
            MSGRAPH_MAX_TOKEN_CACHE_MS
          );
          msGraphTokenCache.set(cacheKey, {
            accessToken,
            expiresAt: now + safeTtlMs,
          });
        }

        const graphMessage: Record<string, any> = {
          subject: message.subject,
          body: {
            contentType: 'HTML',
            content: message.htmlContent,
          },
          toRecipients: message.to.map((address) => ({
            emailAddress: { address },
          })),
        };
        if (message.replyTo) {
          graphMessage.replyTo = [{ emailAddress: { address: message.replyTo } }];
        }
        if (Array.isArray(message.attachments) && message.attachments.length > 0) {
          graphMessage.attachments = message.attachments.map((att) => ({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: att.filename,
            contentType: att.contentType || 'application/octet-stream',
            contentBytes: att.contentBase64,
          }));
        }

        const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
          message.fromEmail
        )}/sendMail`;
        const sendResp = await customFetch(sendUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: graphMessage,
            saveToSentItems: true,
          }),
        });

        if (sendResp.status !== 202 && !sendResp.ok) {
          if (sendResp.status === 401) {
            msGraphTokenCache.delete(cacheKey);
          }
          const errData: any = await sendResp.json().catch(() => ({}));
          const graphErrCode = String(errData?.error?.code || errData?.error || '');
          const graphErrMsg = String(
            errData?.error?.message || errData?.message || `HTTP ${sendResp.status}`
          );
          const retryAfter =
            sendResp.headers?.get?.('Retry-After') ||
            sendResp.headers?.get?.('retry-after') ||
            null;
          const retrySec = retryAfter && /^\d+$/.test(retryAfter.trim())
            ? Number(retryAfter.trim())
            : undefined;

          return {
            ok: false,
            provider: 'msgraph',
            statusCode: sendResp.status,
            retryAfterSeconds: retrySec,
            error: normalizeMsGraphError(graphErrMsg, sendResp.status, {
              errorCode: graphErrCode,
              fromEmail: message.fromEmail,
              retryAfter,
              secretsToRedact: [secret, accessToken],
            }),
          };
        }

        const reqId =
          sendResp.headers?.get?.('request-id') ||
          sendResp.headers?.get?.('client-request-id') ||
          'msgraph-202';

        return {
          ok: true,
          provider: 'msgraph',
          statusCode: sendResp.status || 202,
          messageId: reqId,
        };
      }

      case 'smtp': {
        const smtpPort = Number(config.smtp_port ?? config.port);
        if (smtpPort === 25) {
          return {
            ok: false,
            provider: 'smtp',
            statusCode: 400,
            error:
              "Port SMTP 25 non pris en charge par l'environnement Edge Functions (bloqué contre le spam). Utilisez le port 587 (STARTTLS) ou 465 (SSL/TLS).",
          };
        }
        const transport = customSmtpSend || sendSmtpNativeDeno;
        const smtpRes = await transport(config, message);
        if (!smtpRes.ok) {
          return {
            ok: false,
            provider: 'smtp',
            statusCode: 502,
            error: sanitizeAndTranslateMailError(
              smtpRes.error || 'Échec de transmission SMTP',
              undefined,
              'smtp',
              secret
            ),
          };
        }
        return {
          ok: true,
          provider: 'smtp',
          statusCode: 200,
          messageId: smtpRes.messageId || 'smtp-ok',
        };
      }

      default:
        return {
          ok: false,
          provider,
          error: `Fournisseur d'e-mail non reconnu : ${String(provider)}`,
        };
    }
  } catch (err: any) {
    return {
      ok: false,
      provider,
      error: sanitizeAndTranslateMailError(err, undefined, provider, secret),
    };
  }
}
// -------------------------------------------------------------------------
// Module inliné : _shared/passwordResetHandler.ts
// -------------------------------------------------------------------------
export const GENERIC_PASSWORD_RESET_MESSAGE =
  "Si ce compte existe, un code a été envoyé.";

export const PASSWORD_RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const PASSWORD_RESET_RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const PASSWORD_RESET_MAX_REQUESTS_PER_WINDOW = 3;
export const PASSWORD_RESET_MAX_ATTEMPTS = 5;

const EMAIL_SIMPLE_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PasswordResetHandlerDeps {
  getEnv?: (key: string) => string | undefined;
  createAdminClient?: (supabaseUrl: string, serviceRoleKey: string) => any;
  fetchImpl?: FetchLike;
  smtpTransport?: SmtpTransportFn;
  generateSixDigitCode?: () => string;
  now?: () => Date;
}

export function normalizeResetEmail(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase();
}

export function generateSecureSixDigitCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const n = 100000 + (buf[0] % 900000);
  return String(n);
}

export async function hashPasswordResetCode(
  code: string,
  email: string
): Promise<string> {
  const normalizedCode = String(code || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const data = new TextEncoder().encode(`${normalizedCode}:${normalizedEmail}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function escapeHtml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildPasswordResetEmailContent(
  code: string,
  userName?: string | null
): { subject: string; textContent: string; htmlContent: string } {
  const greeting = userName ? `Bonjour ${userName},` : "Bonjour,";
  const subject = "TOT Stock — Code de réinitialisation de votre mot de passe";
  const textContent = [
    greeting,
    "",
    `Votre code de réinitialisation TOT Stock est : ${code}`,
    "",
    "Ce code à 6 chiffres est valable pendant 15 minutes.",
    "Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail en toute sécurité.",
  ].join("\n");

  const htmlContent = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #0f172a;">
  <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #f97316; margin-bottom: 8px;">TOT Stock</div>
  <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 800; color: #0f172a;">Réinitialisation de votre mot de passe</h2>
  <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #334155;">${escapeHtml(greeting)}</p>
  <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #334155;">Utilisez le code à usage unique ci-dessous dans l'application TOT Stock (Web, Mobile ou Desktop) pour définir votre nouveau mot de passe :</p>
  <div style="margin: 24px 0; padding: 18px; border-radius: 12px; background-color: #f8fafc; border: 2px dashed #cbd5e1; text-align: center;">
    <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 32px; font-weight: 900; letter-spacing: 0.25em; color: #0f172a;">${escapeHtml(code)}</span>
  </div>
  <p style="margin: 0 0 12px 0; font-size: 13px; color: #64748b;">⏳ Ce code est valable pendant <strong>15 minutes</strong>.</p>
  <p style="margin: 0; font-size: 12px; color: #94a3b8;">Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail : votre mot de passe actuel reste inchangé.</p>
</div>`;

  return { subject, textContent, htmlContent };
}

function isMissingPasswordResetsTableError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || "");
  const msg = String(err.message || err.details || err || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /core_password_resets.*does not exist|relation .*core_password_resets.* does not exist|Could not find the table .*core_password_resets/i.test(
      msg
    )
  );
}

async function resolvePasswordResetMailConfig(
  supabaseAdmin: any
): Promise<{ ok: true; config: ResolvedMailConfig } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabaseAdmin.rpc("get_mail_config", {
      p_app_code: "stk",
    });

    if (error) {
      const rawMsg = String(error.message || error.details || error || "").trim();
      const isMissingRpc =
        error.code === "42883" ||
        error.code === "PGRST202" ||
        /function .*get_mail_config.* does not exist|Could not find the function/i.test(rawMsg);

      if (!isMissingRpc) {
        return {
          ok: false,
          error:
            "Envoi d'e-mail non configuré — demandez à votre administrateur de réinitialiser votre mot de passe ou de configurer Paramètres > E-mail",
        };
      }
    } else if (data && typeof data === "object") {
      const rawObj = data as Record<string, any>;
      if (
        rawObj.error === "NO_MAIL_ACCOUNT" ||
        rawObj.error === "NO_SECRET" ||
        rawObj.reason === "missing_secret" ||
        rawObj.reason === "no_active_account"
      ) {
        return {
          ok: false,
          error:
            "Envoi d'e-mail non configuré — demandez à votre administrateur de réinitialiser votre mot de passe ou de configurer Paramètres > E-mail",
        };
      }

      const secretVal = String(rawObj.secret || "").trim();
      const providerVal = String(rawObj.provider || "").trim();
      if (secretVal && providerVal) {
        return {
          ok: true,
          config: {
            configured: true,
            account_id: rawObj.account_id || null,
            account_name: rawObj.account_name || null,
            provider: rawObj.provider,
            preset: rawObj.preset || null,
            smtp_host: rawObj.smtp_host || rawObj.host || null,
            smtp_port: rawObj.smtp_port || rawObj.port || null,
            smtp_encryption: rawObj.smtp_encryption || rawObj.encryption || null,
            smtp_username: rawObj.smtp_username || rawObj.username || null,
            host: rawObj.host || rawObj.smtp_host || null,
            port: rawObj.port || rawObj.smtp_port || null,
            encryption: rawObj.encryption || rawObj.smtp_encryption || null,
            username: rawObj.username || rawObj.smtp_username || null,
            secret: secretVal,
            extra: rawObj.extra || {},
            app_code: "stk",
            from_name: rawObj.from_name || "TOT Stock",
            from_email: rawObj.from_email || "no-reply@tot-stock.pro",
            reply_to: rawObj.reply_to || null,
          },
        };
      }
    }

    const fallback = await readEmailSecretConfig(supabaseAdmin);
    if (fallback.configured && fallback.apiKey) {
      return {
        ok: true,
        config: {
          configured: true,
          legacy: true,
          provider: "brevo",
          preset: "brevo",
          secret: fallback.apiKey,
          app_code: "stk",
          from_name: fallback.senderName || "TOT Stock",
          from_email: fallback.senderEmail || "no-reply@tot-stock.pro",
          reply_to: null,
        },
      };
    }

    return {
      ok: false,
      error:
        "Envoi d'e-mail non configuré — demandez à votre administrateur de réinitialiser votre mot de passe ou de configurer Paramètres > E-mail",
    };
  } catch {
    return {
      ok: false,
      error:
        "Envoi d'e-mail non configuré — demandez à votre administrateur de réinitialiser votre mot de passe ou de configurer Paramètres > E-mail",
    };
  }
}

async function writePasswordResetAuditLog(
  supabaseAdmin: any,
  entry: {
    action: "PASSWORD_RESET_REQUESTED" | "PASSWORD_RESET_COMPLETED";
    user_id: string;
    user_name?: string | null;
    email: string;
  }
): Promise<void> {
  try {
    await supabaseAdmin.from(TABLES.auditLogs).insert({
      user_id: entry.user_id,
      user_name: entry.user_name || entry.email,
      action: entry.action,
      entity_type: "auth",
      entity_id: entry.user_id,
      details:
        entry.action === "PASSWORD_RESET_REQUESTED"
          ? `Code de réinitialisation demandé pour ${entry.email}`
          : `Mot de passe réinitialisé par code pour ${entry.email}`,
      meta: { email: entry.email },
    });
  } catch {
    // Journalisation best-effort
  }
}

async function writePasswordResetMailLog(
  supabaseAdmin: any,
  entry: {
    account_id?: string | null;
    provider?: string | null;
    sender_email?: string | null;
    recipient_email: string;
    subject: string;
    status: "sent" | "failed";
    error_message?: string | null;
    user_id?: string | null;
  }
): Promise<void> {
  try {
    await supabaseAdmin.from(TABLES.mailLog).insert({
      app_code: "stk",
      account_id: entry.account_id || null,
      provider: entry.provider || null,
      sender_email: entry.sender_email || null,
      recipient_masked: maskEmailRecipientList([entry.recipient_email]),
      recipient_count: 1,
      subject: entry.subject,
      kind: "notification",
      status: entry.status,
      error_message: entry.error_message || null,
      user_id: entry.user_id || null,
    });
  } catch {
    // Journalisation best-effort
  }
}

export function createPasswordResetHandler(
  deps: PasswordResetHandlerDeps = {}
): (req: Request) => Promise<Response> {
  const getEnv =
    deps.getEnv ??
    ((key: string) => {
      try {
        return (globalThis as any).Deno?.env?.get(key);
      } catch {
        return undefined;
      }
    });

  const createAdmin =
    deps.createAdminClient ??
    ((supabaseUrl: string, serviceRoleKey: string) =>
      createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }));

  const generateCode = deps.generateSixDigitCode ?? generateSecureSixDigitCode;
  const nowFn = deps.now ?? (() => new Date());

  return async function handlePasswordResetRequest(req: Request): Promise<Response> {
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;

    try {
      const body = await req.json().catch(() => ({}));
      const action = String(body?.action || "").trim();

      if (action === "ping") {
        return jsonResponse({ success: true, status: "ok" }, 200);
      }

      const envVars = getSupabaseEnv();
      const supabaseUrl = getEnv("SUPABASE_URL") || envVars.supabaseUrl;
      const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY") || envVars.serviceRoleKey;

      if (!supabaseUrl || !serviceRoleKey) {
        return jsonResponse(
          {
            success: false,
            error:
              "Configuration serveur Supabase incomplète (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
          },
          500
        );
      }

      const supabaseAdmin = createAdmin(supabaseUrl, serviceRoleKey);

      if (action === "request") {
        const normalizedEmail = normalizeResetEmail(body?.email);
        if (
          !normalizedEmail ||
          normalizedEmail.length > 254 ||
          !EMAIL_SIMPLE_REGEX.test(normalizedEmail)
        ) {
          return jsonResponse(
            { success: true, message: GENERIC_PASSWORD_RESET_MESSAGE },
            200
          );
        }

        // Purge opportuniste des codes expirés + détection table core_password_resets absente
        const purgeRes = await supabaseAdmin.rpc("purge_expired_password_resets");
        if (purgeRes?.error && isMissingPasswordResetsTableError(purgeRes.error)) {
          return jsonResponse(
            {
              success: false,
              error:
                "Table core_password_resets absente — exécutez install_v55.sql (ou 18_password_reset.sql)",
            },
            500
          );
        }

        const now = nowFn();
        const sinceIso = new Date(now.getTime() - PASSWORD_RESET_RATE_WINDOW_MS).toISOString();

        // Limitation : max 3 demandes par e-mail sur 15 minutes
        const { count: recentCount, error: countErr } = await supabaseAdmin
          .from(TABLES.passwordResets)
          .select("id", { count: "exact", head: true })
          .eq("email", normalizedEmail)
          .gte("created_at", sinceIso);

        if (countErr) {
          if (isMissingPasswordResetsTableError(countErr)) {
            return jsonResponse(
              {
                success: false,
                error:
                  "Table core_password_resets absente — exécutez install_v55.sql (ou 18_password_reset.sql)",
              },
              500
            );
          }
          return jsonResponse(
            { success: true, message: GENERIC_PASSWORD_RESET_MESSAGE },
            200
          );
        }

        if ((recentCount ?? 0) >= PASSWORD_RESET_MAX_REQUESTS_PER_WINDOW) {
          return jsonResponse(
            { success: true, message: GENERIC_PASSWORD_RESET_MESSAGE },
            200
          );
        }

        // Recherche du compte actif dans core_users
        const { data: matchedUsers, error: userErr } = await supabaseAdmin
          .from(TABLES.users)
          .select("id, name, email, is_blocked, auth_user_id")
          .ilike("email", normalizedEmail)
          .limit(5);

        if (userErr || !Array.isArray(matchedUsers) || matchedUsers.length === 0) {
          return jsonResponse(
            { success: true, message: GENERIC_PASSWORD_RESET_MESSAGE },
            200
          );
        }

        const activeUser = matchedUsers.find(
          (u: any) =>
            String(u.email || "").trim().toLowerCase() === normalizedEmail &&
            !u.is_blocked &&
            u.auth_user_id
        );

        if (!activeUser) {
          return jsonResponse(
            { success: true, message: GENERIC_PASSWORD_RESET_MESSAGE },
            200
          );
        }

        // Résoudre la configuration d'envoi d'e-mail (get_mail_config('stk'))
        const mailCfgResult = await resolvePasswordResetMailConfig(supabaseAdmin);
        if (!mailCfgResult.ok) {
          return jsonResponse(
            {
              success: false,
              error: mailCfgResult.error,
            },
            500
          );
        }

        const mailConfig = mailCfgResult.config;

        // Invalider les codes précédents non utilisés pour cet e-mail
        await supabaseAdmin
          .from(TABLES.passwordResets)
          .update({ used_at: now.toISOString() })
          .eq("email", normalizedEmail)
          .is("used_at", null);

        // Générer le code à 6 chiffres et stocker uniquement son hash SHA-256
        const sixDigitCode = generateCode();
        const codeHash = await hashPasswordResetCode(sixDigitCode, normalizedEmail);
        const expiresAtIso = new Date(
          now.getTime() + PASSWORD_RESET_CODE_TTL_MS
        ).toISOString();

        const { error: insertErr } = await supabaseAdmin
          .from(TABLES.passwordResets)
          .insert({
            user_id: String(activeUser.id),
            email: normalizedEmail,
            code_hash: codeHash,
            expires_at: expiresAtIso,
            attempts: 0,
          });

        if (insertErr) {
          if (isMissingPasswordResetsTableError(insertErr)) {
            return jsonResponse(
              {
                success: false,
                error:
                  "Table core_password_resets absente — exécutez install_v55.sql (ou 18_password_reset.sql)",
              },
              500
            );
          }
          return jsonResponse(
            {
              success: false,
              error: "Impossible d'enregistrer le code de réinitialisation.",
            },
            500
          );
        }

        const { subject, htmlContent } = buildPasswordResetEmailContent(
          sixDigitCode,
          activeUser.name
        );

        const fromName = String(mailConfig.from_name || "TOT Stock").trim();
        const fromEmail = String(
          mailConfig.from_email || "no-reply@tot-stock.pro"
        ).trim();

        const dispatchRes = await sendMailWithProvider(
          mailConfig,
          {
            fromName,
            fromEmail,
            replyTo: mailConfig.reply_to || null,
            to: [normalizedEmail],
            subject,
            htmlContent,
          },
          deps.fetchImpl,
          deps.smtpTransport
        );

        if (!dispatchRes.ok) {
          const cleanErr = sanitizeAndTranslateMailError(
            dispatchRes.error || "Échec d'envoi de l'e-mail",
            dispatchRes.statusCode,
            dispatchRes.provider,
            mailConfig.secret
          );

          await writePasswordResetMailLog(supabaseAdmin, {
            account_id: mailConfig.account_id || null,
            provider: dispatchRes.provider,
            sender_email: fromEmail,
            recipient_email: normalizedEmail,
            subject,
            status: "failed",
            error_message: cleanErr,
            user_id: String(activeUser.id),
          });

          return jsonResponse(
            {
              success: false,
              error: cleanErr,
            },
            502
          );
        }

        await writePasswordResetMailLog(supabaseAdmin, {
          account_id: mailConfig.account_id || null,
          provider: dispatchRes.provider,
          sender_email: fromEmail,
          recipient_email: normalizedEmail,
          subject,
          status: "sent",
          user_id: String(activeUser.id),
        });

        await writePasswordResetAuditLog(supabaseAdmin, {
          action: "PASSWORD_RESET_REQUESTED",
          user_id: String(activeUser.id),
          user_name: activeUser.name,
          email: normalizedEmail,
        });

        return jsonResponse(
          { success: true, message: GENERIC_PASSWORD_RESET_MESSAGE },
          200
        );
      }

      if (action === "confirm") {
        const normalizedEmail = normalizeResetEmail(body?.email);
        const cleanCode = String(body?.code || "").trim();
        const newPassword =
          typeof body?.newPassword === "string" ? body.newPassword : "";

        if (newPassword.length < 6 || newPassword.length > 72) {
          return jsonResponse(
            {
              success: false,
              error: "Le mot de passe doit contenir entre 6 et 72 caractères.",
            },
            400
          );
        }

        if (
          !normalizedEmail ||
          !EMAIL_SIMPLE_REGEX.test(normalizedEmail) ||
          !/^\d{6}$/.test(cleanCode)
        ) {
          return jsonResponse(
            { success: false, error: "Code invalide ou expiré" },
            400
          );
        }

        const now = nowFn();
        const nowIso = now.toISOString();

        const { data: activeRows, error: fetchErr } = await supabaseAdmin
          .from(TABLES.passwordResets)
          .select("id, user_id, email, code_hash, expires_at, attempts, used_at, created_at")
          .eq("email", normalizedEmail)
          .is("used_at", null)
          .gt("expires_at", nowIso)
          .order("created_at", { ascending: false })
          .limit(1);

        if (fetchErr) {
          if (isMissingPasswordResetsTableError(fetchErr)) {
            return jsonResponse(
              {
                success: false,
                error:
                  "Table core_password_resets absente — exécutez install_v55.sql (ou 18_password_reset.sql)",
              },
              500
            );
          }
          return jsonResponse(
            { success: false, error: "Code invalide ou expiré" },
            400
          );
        }

        const resetRow =
          Array.isArray(activeRows) && activeRows.length > 0
            ? activeRows[0]
            : null;

        if (!resetRow || Number(resetRow.attempts || 0) >= PASSWORD_RESET_MAX_ATTEMPTS) {
          return jsonResponse(
            { success: false, error: "Code invalide ou expiré" },
            400
          );
        }

        const expectedHash = await hashPasswordResetCode(
          cleanCode,
          normalizedEmail
        );
        const matches = timingSafeEqualHex(
          expectedHash,
          String(resetRow.code_hash || "")
        );

        if (!matches) {
          const nextAttempts = Number(resetRow.attempts || 0) + 1;
          const patch: Record<string, unknown> = { attempts: nextAttempts };
          if (nextAttempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
            patch.used_at = nowIso;
          }
          await supabaseAdmin
            .from(TABLES.passwordResets)
            .update(patch)
            .eq("id", resetRow.id);

          return jsonResponse(
            { success: false, error: "Code invalide ou expiré" },
            400
          );
        }

        // Vérifier le profil utilisateur lié
        const { data: matchedUsers } = await supabaseAdmin
          .from(TABLES.users)
          .select("id, name, email, is_blocked, auth_user_id")
          .ilike("email", normalizedEmail)
          .limit(5);

        const targetUser = Array.isArray(matchedUsers)
          ? matchedUsers.find(
              (u: any) =>
                String(u.id) === String(resetRow.user_id) ||
                String(u.email || "").trim().toLowerCase() === normalizedEmail
            )
          : null;

        if (!targetUser || targetUser.is_blocked || !targetUser.auth_user_id) {
          await supabaseAdmin
            .from(TABLES.passwordResets)
            .update({ used_at: nowIso })
            .eq("id", resetRow.id);

          return jsonResponse(
            { success: false, error: "Code invalide ou expiré" },
            400
          );
        }

        // Mettre à jour le mot de passe dans auth.users via Admin API
        const { error: updateAuthErr } =
          await supabaseAdmin.auth.admin.updateUserById(
            String(targetUser.auth_user_id),
            { password: newPassword }
          );

        if (updateAuthErr) {
          return jsonResponse(
            {
              success: false,
              error:
                updateAuthErr.message ||
                "Impossible de mettre à jour le mot de passe.",
            },
            500
          );
        }

        // Révoquer les sessions actives de l'utilisateur
        try {
          if (typeof supabaseAdmin.auth.admin.signOut === "function") {
            await supabaseAdmin.auth.admin.signOut(
              String(targetUser.auth_user_id),
              "global"
            );
          }
        } catch {
          // Non bloquant si signOut global n'est pas supporté par la version GoTrue
        }

        // Marquer le code comme utilisé
        await supabaseAdmin
          .from(TABLES.passwordResets)
          .update({ used_at: nowIso })
          .eq("id", resetRow.id);

        // Remettre must_change_pin à false dans core_users
        await supabaseAdmin
          .from(TABLES.users)
          .update({ must_change_pin: false })
          .eq("id", targetUser.id);

        // Tracer PASSWORD_RESET_COMPLETED dans core_audit_logs (sans code ni mot de passe)
        await writePasswordResetAuditLog(supabaseAdmin, {
          action: "PASSWORD_RESET_COMPLETED",
          user_id: String(targetUser.id),
          user_name: targetUser.name,
          email: normalizedEmail,
        });

        return jsonResponse({ success: true }, 200);
      }

      return jsonResponse(
        { success: false, error: `Action inconnue : ${action}` },
        400
      );
    } catch (err: any) {
      return jsonResponse(
        {
          success: false,
          error: err?.message || "Erreur interne du serveur",
        },
        500
      );
    }
  };
}

export const handlePasswordResetRequest = createPasswordResetHandler();

// -------------------------------------------------------------------------
// Point d'entrée Deno Edge Function
// -------------------------------------------------------------------------
serve(createPasswordResetHandler());
