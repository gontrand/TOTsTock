// =========================================================================
// TOT STOCK — FONCTION EDGE AUTONOME (FICHIER UNIQUE COPIER-COLLER)
// Nom exact à créer dans Supabase : APP_TOT-Stock_send-report-email
// Rôle : Envoi transactionnel des rapports et alertes par e-mail (Brevo / SMTP)
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
// Module inliné : _shared/sendReportEmailHandler.ts
// -------------------------------------------------------------------------
export const MAX_RECIPIENTS_PER_CALL = 20;
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_EMAIL_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 Mo
export const MAX_EMAILS_PER_USER_PER_HOUR = 30;
export const MAX_ATTACHMENTS = 5;
export const MAX_TOTAL_ATTACHMENT_BYTES = 3 * 1024 * 1024; // 3 Mo (limite Microsoft Graph / pièces jointes)
export const ALLOWED_ATTACHMENT_TYPES = ['text/csv', 'application/pdf'] as const;
export type AllowedAttachmentMimeType = (typeof ALLOWED_ATTACHMENT_TYPES)[number];

const EMAIL_VALIDATION_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function sanitizeAttachmentFilename(
  rawFilename: string,
  mimeType: AllowedAttachmentMimeType
): string {
  const expectedExt = mimeType === 'application/pdf' ? '.pdf' : '.csv';
  // Supprimer tout chemin éventuel (/ ou \) et caractères de contrôle
  const baseName = String(rawFilename || '')
    .replace(/[\r\n\0]/g, '')
    .split(/[/\\]/)
    .pop()
    ?.trim() || `rapport${expectedExt}`;

  const safeChars = baseName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^\.+/, '');

  const truncated = (safeChars || `rapport${expectedExt}`).slice(0, 110);
  if (truncated.toLowerCase().endsWith(expectedExt)) {
    return truncated;
  }
  const withoutWrongExt = truncated.replace(/\.(csv|pdf)$/i, '');
  return `${withoutWrongExt || 'rapport'}${expectedExt}`;
}

function decodeBase64Strict(rawBase64: string): Uint8Array | null {
  const cleaned = String(rawBase64 || '')
    .trim()
    .replace(/^data:[^;]+;base64,/i, '')
    .replace(/\s+/g, '');

  if (!cleaned || cleaned.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
    return null;
  }

  try {
    if (typeof atob === 'function') {
      const bin = atob(cleaned);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) {
        out[i] = bin.charCodeAt(i);
      }
      return out;
    }
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(cleaned, 'base64'));
    }
    return null;
  } catch {
    return null;
  }
}

export function validateAttachmentInput(rawAttachments: unknown):
  | {
      ok: true;
      attachments: MailAttachmentInput[];
      totalBytes: number;
    }
  | {
      ok: false;
      error: string;
    } {
  if (rawAttachments === undefined || rawAttachments === null) {
    return { ok: true, attachments: [], totalBytes: 0 };
  }
  if (!Array.isArray(rawAttachments)) {
    return {
      ok: false,
      error: 'Format de pièces jointes invalide : "attachments" doit être un tableau.',
    };
  }
  if (rawAttachments.length > MAX_ATTACHMENTS) {
    return {
      ok: false,
      error: `Nombre maximal de pièces jointes dépassé (${rawAttachments.length}/${MAX_ATTACHMENTS} max).`,
    };
  }

  const validated: MailAttachmentInput[] = [];
  let totalBytes = 0;

  for (let idx = 0; idx < rawAttachments.length; idx += 1) {
    const item = rawAttachments[idx] as Record<string, unknown> | null;
    if (!item || typeof item !== 'object') {
      return {
        ok: false,
        error: `Pièce jointe #${idx + 1} invalide.`,
      };
    }

    const rawFilename = typeof item.filename === 'string' ? item.filename.trim() : '';
    const rawBase64 = (
      typeof item.contentBase64 === 'string'
        ? item.contentBase64
        : typeof item.content === 'string'
        ? item.content
        : ''
    ).trim();
    const rawType = String(item.contentType || item.type || item.mimeType || '')
      .split(';')[0]
      .trim()
      .toLowerCase();

    if (!rawFilename || !rawBase64) {
      return {
        ok: false,
        error: `Pièce jointe #${idx + 1} incomplète : "filename" et "contentBase64" sont requis.`,
      };
    }

    // Si contentType est omis, le déduire de l'extension (.csv ou .pdf uniquement)
    const effectiveType =
      rawType ||
      (rawFilename.toLowerCase().endsWith('.pdf')
        ? 'application/pdf'
        : rawFilename.toLowerCase().endsWith('.csv')
        ? 'text/csv'
        : '');

    if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(effectiveType)) {
      return {
        ok: false,
        error: `Type MIME non autorisé pour "${rawFilename}" ("${rawType || 'inconnu'}"). Seuls text/csv et application/pdf sont acceptés.`,
      };
    }

    const mimeType = effectiveType as AllowedAttachmentMimeType;
    const decoded = decodeBase64Strict(rawBase64);
    if (!decoded || decoded.byteLength === 0) {
      return {
        ok: false,
        error: `Pièce jointe "${rawFilename}" invalide : contenu base64 mal formé ou vide.`,
      };
    }

    if (mimeType === 'application/pdf') {
      // Vérification de la signature %PDF (0x25 0x50 0x44 0x46)
      const isPdfMagic =
        decoded.byteLength >= 4 &&
        decoded[0] === 0x25 &&
        decoded[1] === 0x50 &&
        decoded[2] === 0x44 &&
        decoded[3] === 0x46;
      if (!isPdfMagic) {
        return {
          ok: false,
          error: `Pièce jointe PDF "${rawFilename}" invalide : signature %PDF absente.`,
        };
      }
    }

    totalBytes += decoded.byteLength;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return {
        ok: false,
        error: `Taille cumulée des pièces jointes dépassée (${(totalBytes / (1024 * 1024)).toFixed(2)} Mo > 3 Mo maximum). Envoyez uniquement le CSV ou réduisez la période.`,
      };
    }

    const cleanBase64 = rawBase64
      .replace(/^data:[^;]+;base64,/i, '')
      .replace(/\s+/g, '');

    validated.push({
      filename: sanitizeAttachmentFilename(rawFilename, mimeType),
      contentBase64: cleanBase64,
      contentType: mimeType,
    });
  }

  return {
    ok: true,
    attachments: validated,
    totalBytes,
  };
}

export interface SendReportEmailDeps {
  authenticate?: (
    req: Request
  ) => Promise<{ ok: true; ctx: AuthenticatedCallerContext } | { ok: false; response: Response }>;
  fetchFn?: FetchLike;
  smtpTransport?: SmtpTransportFn;
  maxPerHour?: number;
}

export function normalizeAppCode(rawAppCode: unknown): string {
  const cleaned = String(rawAppCode || 'stk')
    .trim()
    .toLowerCase();
  if (!cleaned || !/^[a-z0-9_-]{2,16}$/.test(cleaned)) {
    return 'stk';
  }
  return cleaned;
}

export function parseAndValidateRecipients(rawTo: unknown): {
  ok: true;
  recipients: string[];
} | {
  ok: false;
  error: string;
} {
  const list: string[] = [];
  if (typeof rawTo === 'string') {
    const parts = rawTo
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    list.push(...parts);
  } else if (Array.isArray(rawTo)) {
    for (const item of rawTo) {
      if (typeof item === 'string' && item.trim()) {
        list.push(item.trim());
      }
    }
  }

  const unique = Array.from(new Set(list));
  if (unique.length === 0) {
    return {
      ok: false,
      error: 'Destinataire manquant : au moins une adresse e-mail valide est requise dans "to".',
    };
  }
  if (unique.length > MAX_RECIPIENTS_PER_CALL) {
    return {
      ok: false,
      error: `Nombre maximal de destinataires dépassé (${unique.length}/${MAX_RECIPIENTS_PER_CALL} max par envoi).`,
    };
  }
  for (const addr of unique) {
    if (addr.length > 254 || !EMAIL_VALIDATION_REGEX.test(addr)) {
      return {
        ok: false,
        error: `Adresse e-mail destinataire invalide : "${addr}".`,
      };
    }
  }
  return { ok: true, recipients: unique };
}

/**
 * Lit la configuration d'envoi depuis la RPC `public.get_mail_config(p_app_code)` (exécutable par service_role uniquement).
 * Si `get_mail_config` renvoie une erreur (ex. Accès refusé / Vault / permission), ne retombe PAS silencieusement
 * sur « non configuré » : journalise l'erreur et renvoie `config_error: "Lecture de la configuration e-mail refusée : <message>"`.
 * Le repli sur `readEmailSecretConfig` n'est utilisé que si la fonction RPC `get_mail_config` n'existe pas encore (base N-1 avant script 14).
 */
export async function resolveServerMailConfig(
  supabaseAdmin: any,
  appCode: string
): Promise<ResolvedMailConfig> {
  try {
    let { data, error } = await supabaseAdmin.rpc('get_mail_config', {
      p_app_code: appCode,
    });
    // Si l'expéditeur 'rpt' n'est pas encore configuré mais que 'stk' l'est, repli transparent sur 'stk'
    if (!error && data && typeof data === 'object' && !(data as ResolvedMailConfig).configured && appCode !== 'stk') {
      const stkFallback = await supabaseAdmin.rpc('get_mail_config', {
        p_app_code: 'stk',
      });
      if (!stkFallback.error && stkFallback.data && (stkFallback.data as ResolvedMailConfig).configured) {
        data = {
          ...(stkFallback.data as ResolvedMailConfig),
          app_code: appCode,
        };
      }
    }
    if (error) {
      const rawErrMsg = String(error.message || error.details || error || '').trim();
      const isMissingRpc =
        error.code === '42883' ||
        error.code === 'PGRST202' ||
        /function .*get_mail_config.* does not exist|Could not find the function/i.test(rawErrMsg);

      if (!isMissingRpc) {
        const cleanErr = sanitizeAndTranslateMailError(rawErrMsg || 'Erreur RPC get_mail_config');
        const explicitMsg = `Lecture de la configuration e-mail refusée : ${rawErrMsg || cleanErr}`;
        console.error('[send-report-email]', explicitMsg);
        return {
          configured: false,
          config_error: explicitMsg,
          app_code: appCode,
        };
      }
    } else if (data && typeof data === 'object') {
      const cfg = data as ResolvedMailConfig;
      // En mode legacy (aucun compte dans core_mail_accounts), compléter éventuellement avec BREVO_API_KEY d'env
      if (!cfg.configured && cfg.legacy) {
        const fallback = await readEmailSecretConfig(supabaseAdmin);
        if (fallback.configured && fallback.apiKey) {
          return {
            configured: true,
            legacy: true,
            provider: 'brevo',
            preset: 'brevo',
            secret: fallback.apiKey,
            app_code: appCode,
            from_name: cfg.from_name || fallback.senderName || 'TOT Stock',
            from_email: cfg.from_email || fallback.senderEmail || 'no-reply@tot-stock.pro',
            reply_to: cfg.reply_to || null,
          };
        }
      }
      return {
        ...cfg,
        app_code: cfg.app_code || appCode,
        from_name: String(cfg.from_name || 'TOT Stock').trim(),
        from_email: String(cfg.from_email || 'no-reply@tot-stock.pro').trim(),
      };
    }
  } catch (err: any) {
    const rawErrMsg = String(err?.message || err || '').trim();
    const isMissingRpc =
      /function .*get_mail_config.* does not exist|Could not find the function/i.test(rawErrMsg);
    if (!isMissingRpc && rawErrMsg) {
      const explicitMsg = `Lecture de la configuration e-mail refusée : ${rawErrMsg}`;
      console.error('[send-report-email]', explicitMsg);
      return {
        configured: false,
        config_error: explicitMsg,
        app_code: appCode,
      };
    }
  }

  const fallback = await readEmailSecretConfig(supabaseAdmin);
  return {
    configured: Boolean(fallback.configured && fallback.apiKey),
    legacy: true,
    provider: 'brevo',
    preset: 'brevo',
    secret: fallback.apiKey,
    app_code: appCode,
    from_name: fallback.senderName || 'TOT Stock',
    from_email: fallback.senderEmail || 'no-reply@tot-stock.pro',
    reply_to: null,
  };
}

export const VALID_MAIL_KINDS = ['transactional', 'report', 'order', 'alert', 'test'] as const;
export type MailLogKind = (typeof VALID_MAIL_KINDS)[number];
export const MAIL_ADMIN_ROLE_IDS = [0, 1, 5, 8] as const;

export function normalizeMailKind(rawKind: unknown, isTest = false): MailLogKind {
  if (isTest) return 'test';
  const cleaned = String(rawKind || '')
    .trim()
    .toLowerCase();
  if ((VALID_MAIL_KINDS as readonly string[]).includes(cleaned)) {
    return cleaned as MailLogKind;
  }
  return 'report';
}

export interface MailLogInsertInput {
  app_code: string;
  account_id?: string | null;
  provider?: string | null;
  sender_email?: string | null;
  recipient_masked: string;
  recipient_count?: number;
  subject: string;
  kind?: unknown;
  status: 'sent' | 'failed' | 'not_configured';
  message_id?: string | null;
  error_message?: string | null;
  user_id?: string | null;
}

export function buildMailLogInsertPayload(entry: MailLogInsertInput) {
  const countNum = Number(entry.recipient_count || 1);
  const safeCount = Number.isFinite(countNum)
    ? Math.min(MAX_RECIPIENTS_PER_CALL, Math.max(1, Math.trunc(countNum)))
    : 1;
  return {
    app_code: normalizeAppCode(entry.app_code),
    account_id: entry.account_id || null,
    provider: entry.provider || null,
    sender_email: entry.sender_email || null,
    recipient_masked: entry.recipient_masked,
    recipient_count: safeCount,
    subject: String(entry.subject || '').slice(0, MAX_SUBJECT_LENGTH),
    kind: normalizeMailKind(entry.kind),
    status: entry.status,
    message_id: entry.message_id || null,
    error_message: entry.error_message ? String(entry.error_message).slice(0, 500) : null,
    user_id: entry.user_id || null,
  };
}

async function logMailAttempt(
  supabaseAdmin: any,
  entry: MailLogInsertInput,
  secretToRedact?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const payload = buildMailLogInsertPayload(entry);
  try {
    const res = await supabaseAdmin.from(TABLES.mailLog).insert([payload]);
    if (res && res.error) {
      const cleanErr = sanitizeAndTranslateMailError(
        res.error.message || res.error,
        undefined,
        entry.provider || undefined,
        secretToRedact
      );
      console.error('[send-report-email] Erreur insertion core_mail_log:', cleanErr);
      return { ok: false, error: cleanErr };
    }
    return { ok: true };
  } catch (err: any) {
    const cleanErr = sanitizeAndTranslateMailError(
      err?.message || err,
      undefined,
      entry.provider || undefined,
      secretToRedact
    );
    console.error('[send-report-email] Exception insertion core_mail_log:', cleanErr);
    return { ok: false, error: cleanErr };
  }
}

export async function isRateLimitedForUser(
  supabaseAdmin: any,
  userId: string,
  maxPerHour: number
): Promise<boolean> {
  if (!userId || maxPerHour <= 0) return false;
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await supabaseAdmin
      .from(TABLES.mailLog)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', oneHourAgo);
    if (error) {
      console.error(
        '[send-report-email] Erreur vérification limite horaire core_mail_log:',
        sanitizeAndTranslateMailError(error.message || error)
      );
      return false;
    }
    return typeof count === 'number' && count >= maxPerHour;
  } catch (err: any) {
    console.error(
      '[send-report-email] Exception vérification limite horaire core_mail_log:',
      sanitizeAndTranslateMailError(err?.message || err)
    );
    return false;
  }
}

export function createSendReportEmailHandler(deps: SendReportEmailDeps = {}) {
  const authFn = deps.authenticate || authenticateCaller;
  const fetchFn = deps.fetchFn || fetch;
  const smtpTransport = deps.smtpTransport;
  const maxPerHour = deps.maxPerHour ?? MAX_EMAILS_PER_USER_PER_HOUR;

  return async function handleRequest(req: Request): Promise<Response> {
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;

    try {
      const authRes = await authFn(req);
      if (!authRes.ok) return authRes.response;

      const {
        supabaseAdmin,
        callerProfile,
        callerPerms,
        isSuperAdmin,
        hasUniversal,
      } = authRes.ctx;

      const body = await req.json().catch(() => ({}));
      const appCode = normalizeAppCode(body?.app_code);

      // Action de sonde / statut : permet au Diagnostic, à l'écran E-mails et à « À propos » de vérifier la fonction sans exposer de secret
      if (body?.action === 'status' || body?.action === 'ping') {
        const mailConfig = await resolveServerMailConfig(supabaseAdmin, appCode);
        return jsonResponse(
          {
            success: true,
            function: CLIENT_EDGE_FUNCTIONS.sendReportEmail,
            app_code: appCode,
            configured: Boolean(mailConfig.configured),
            provider: mailConfig.provider || null,
            preset: mailConfig.preset || null,
            account_name: mailConfig.account_name || null,
            from_name: mailConfig.from_name || null,
            from_email: mailConfig.from_email || null,
            legacy: Boolean(mailConfig.legacy),
            status: mailConfig.configured ? 'configuré' : 'non configuré',
            message: mailConfig.configured
              ? 'Service e-mail configuré.'
              : 'non configuré',
          },
          200
        );
      }

      const isTestRequest = Boolean(body?.test);
      const callerRoleId = Number(callerProfile.role_id);
      const isAdminCaller =
        isSuperAdmin ||
        hasUniversal ||
        (MAIL_ADMIN_ROLE_IDS as readonly number[]).includes(callerRoleId) ||
        callerPerms.includes('perm_config_email') ||
        callerPerms.includes('perm_config_db');

      const hasPermission =
        isAdminCaller ||
        callerPerms.includes('perm_report_view') ||
        callerPerms.includes('perm_email_manual_send');

      if (!hasPermission || (isTestRequest && !isAdminCaller)) {
        return jsonResponse(
          {
            success: false,
            error: isTestRequest
              ? "Permission refusée : seul un administrateur (rôles 0, 1, 5, 8 ou perm_config_email / perm_config_db) peut envoyer un e-mail de test."
              : 'Permission refusée : Droits insuffisants (rôles 0, 1, 5, 8, perm_config_email, perm_config_db, perm_report_view ou perm_email_manual_send requis).',
          },
          403
        );
      }

      // Validation des destinataires
      const rawTo = body?.to || (isTestRequest && callerProfile.email ? callerProfile.email : '');
      const rcptValidation = parseAndValidateRecipients(rawTo);
      if (!rcptValidation.ok) {
        return jsonResponse(
          {
            success: false,
            configured: true,
            error: rcptValidation.error,
          },
          400
        );
      }
      const recipients = rcptValidation.recipients;
      const recipientMasked = maskEmailRecipientList(recipients);
      const recipientCount = recipients.length;

      // Validation du sujet et du contenu HTML (avec valeurs par défaut propres en mode test)
      const rawSubject =
        typeof body?.subject === 'string' && body.subject.trim()
          ? body.subject.trim()
          : isTestRequest
          ? `[TOT Suite — ${appCode.toUpperCase()}] E-mail de test de configuration`
          : '';

      const rawHtml =
        typeof body?.htmlContent === 'string' && body.htmlContent.trim()
          ? body.htmlContent
          : isTestRequest
          ? `<div style="font-family:sans-serif;padding:20px;border:1px solid #e2e8f0;border-radius:12px;">
              <h2 style="margin-top:0;color:#0f172a;">Test d'envoi d'e-mail réussi (${appCode.toUpperCase()})</h2>
              <p>Cet e-mail confirme que le compte d'envoi et l'expéditeur de l'application <strong>${appCode}</strong> sont correctement configurés dans votre base Supabase.</p>
            </div>`
          : '';

      if (!rawSubject || !rawHtml) {
        return jsonResponse(
          {
            success: false,
            configured: true,
            error: 'Champs obligatoires manquants : "to", "subject" et "htmlContent" sont requis.',
          },
          400
        );
      }

      if (rawSubject.length > MAX_SUBJECT_LENGTH) {
        return jsonResponse(
          {
            success: false,
            configured: true,
            error: `Le sujet ne peut pas dépasser ${MAX_SUBJECT_LENGTH} caractères.`,
          },
          400
        );
      }

      const attValidation = validateAttachmentInput(body?.attachments);
      if (!attValidation.ok) {
        return jsonResponse(
          {
            success: false,
            configured: true,
            error: attValidation.error,
          },
          400
        );
      }

      const attachments = attValidation.attachments;
      const htmlBytes = new TextEncoder().encode(rawHtml).length;
      if (htmlBytes + attValidation.totalBytes > MAX_EMAIL_PAYLOAD_BYTES) {
        return jsonResponse(
          {
            success: false,
            configured: true,
            error: 'Taille maximale du message ou des pièces jointes dépassée (maximum 5 Mo).',
          },
          400
        );
      }

      const kind = normalizeMailKind(body?.kind, isTestRequest);

      // Vérification de la limite de débit (rate-limit) par utilisateur
      const rateLimited = await isRateLimitedForUser(
        supabaseAdmin,
        String(callerProfile.id),
        maxPerHour
      );
      if (rateLimited) {
        await logMailAttempt(supabaseAdmin, {
          app_code: appCode,
          recipient_masked: recipientMasked,
          recipient_count: recipientCount,
          subject: rawSubject,
          kind,
          status: 'failed',
          error_message: `Limite d'envoi atteinte (${maxPerHour} e-mails / heure maximum par utilisateur).`,
          user_id: String(callerProfile.id),
        });
        return jsonResponse(
          {
            success: false,
            configured: true,
            error: `Limite de débit atteinte : maximum ${maxPerHour} envois par heure et par utilisateur.`,
          },
          429
        );
      }

      // Lecture de la configuration serveur via get_mail_config(app_code)
      // IMPORTANT SÉCURITÉ : sender_name et sender_email du body client sont strictement ignorés.
      const mailConfig = await resolveServerMailConfig(supabaseAdmin, appCode);

      if (mailConfig.config_error) {
        await logMailAttempt(supabaseAdmin, {
          app_code: appCode,
          recipient_masked: recipientMasked,
          recipient_count: recipientCount,
          subject: rawSubject,
          kind,
          status: 'failed',
          error_message: mailConfig.config_error,
          user_id: String(callerProfile.id),
        });

        return jsonResponse(
          {
            success: false,
            configured: false,
            error: mailConfig.config_error,
          },
          500
        );
      }

      if (!mailConfig.configured || !mailConfig.secret) {
        await logMailAttempt(supabaseAdmin, {
          app_code: appCode,
          account_id: mailConfig.account_id || null,
          provider: mailConfig.provider || null,
          sender_email: mailConfig.from_email || null,
          recipient_masked: recipientMasked,
          recipient_count: recipientCount,
          subject: rawSubject,
          kind,
          status: 'not_configured',
          error_message:
            mailConfig.reason === 'missing_secret'
              ? 'Aucun secret enregistré dans Vault pour le compte actif.'
              : 'Aucun compte d’envoi actif configuré.',
          user_id: String(callerProfile.id),
        });

        return jsonResponse(
          {
            success: false,
            configured: false,
            status: 'non configuré',
            error:
              mailConfig.reason === 'missing_secret'
                ? "non configuré : Le compte d'envoi actif n'a pas encore de clé API ou mot de passe enregistré dans Supabase Vault."
                : "non configuré : Aucun compte d'envoi d'e-mail actif n'est configuré (Paramètres > E-mails).",
          },
          200
        );
      }

      const fromName = String(mailConfig.from_name || 'TOT Stock').trim();
      const fromEmail = String(mailConfig.from_email || 'no-reply@tot-stock.pro').trim();

      const dispatchResult = await sendMailWithProvider(
        mailConfig,
        {
          fromName,
          fromEmail,
          replyTo: mailConfig.reply_to || null,
          to: recipients,
          subject: rawSubject,
          htmlContent: rawHtml,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
        fetchFn,
        smtpTransport
      );

      if (!dispatchResult.ok) {
        const cleanError = sanitizeAndTranslateMailError(
          dispatchResult.error || 'Échec d’envoi',
          dispatchResult.statusCode,
          dispatchResult.provider,
          mailConfig.secret
        );

        await logMailAttempt(
          supabaseAdmin,
          {
            app_code: appCode,
            account_id: mailConfig.account_id || null,
            provider: dispatchResult.provider,
            sender_email: fromEmail,
            recipient_masked: recipientMasked,
            recipient_count: recipientCount,
            subject: rawSubject,
            kind,
            status: 'failed',
            error_message: cleanError,
            user_id: String(callerProfile.id),
          },
          mailConfig.secret
        );

        return jsonResponse(
          {
            success: false,
            configured: true,
            provider: dispatchResult.provider,
            from_email: fromEmail,
            from_name: fromName,
            error: cleanError,
          },
          dispatchResult.statusCode && dispatchResult.statusCode >= 400
            ? dispatchResult.statusCode
            : 502
        );
      }

      await logMailAttempt(
        supabaseAdmin,
        {
          app_code: appCode,
          account_id: mailConfig.account_id || null,
          provider: dispatchResult.provider,
          sender_email: fromEmail,
          recipient_masked: recipientMasked,
          recipient_count: recipientCount,
          subject: rawSubject,
          kind,
          status: 'sent',
          message_id: dispatchResult.messageId || null,
          error_message: null,
          user_id: String(callerProfile.id),
        },
        mailConfig.secret
      );

      return jsonResponse(
        {
          success: true,
          configured: true,
          status: 'envoyé',
          app_code: appCode,
          provider: dispatchResult.provider,
          from_name: fromName,
          from_email: fromEmail,
          message: isTestRequest
            ? `E-mail de test expédié avec succès via ${dispatchResult.provider.toUpperCase()} (${fromName} <${fromEmail}>) à ${recipients.join(', ')}.`
            : `Rapport expédié avec succès à ${recipients.join(', ')}.`,
          messageId: dispatchResult.messageId,
        },
        200
      );
    } catch (err: any) {
      return jsonResponse(
        {
          success: false,
          error: sanitizeAndTranslateMailError(err?.message || 'Erreur inattendue serveur'),
        },
        500
      );
    }
  };
}

export const handleSendReportEmailRequest = createSendReportEmailHandler();

// -------------------------------------------------------------------------
// Point d'entrée Deno Edge Function
// -------------------------------------------------------------------------
serve(createSendReportEmailHandler());
