// =========================================================================
// TOT STOCK — FONCTION EDGE AUTONOME (FICHIER UNIQUE COPIER-COLLER)
// Nom exact à créer dans Supabase : APP_TOT-Stock_licenses_sync-license
// Rôle : Vérification cryptographique Ed25519 et écriture de la licence dans core_license_config
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
// Module inliné : _shared/syncLicenseHandler.ts
// -------------------------------------------------------------------------
export const CURRENT_KEY_ID = DEFAULT_KEY_ID;
export const LEGACY_KEY_RETIRED_AT = DEFAULT_LEGACY_RETIRED_AT;

export type CanonicalPlan = 'free' | 'sta' | 'pro' | 'ent';
export type LicenseModule = 'stock' | 'outils' | 'formation' | 'rapports';
export const VALID_MODULES: LicenseModule[] = ['stock', 'outils', 'formation', 'rapports'];

const RECOGNIZED_PLAN_CODES = new Set([
  'free',
  'gratuit',
  'sta',
  'pro',
  'ent',
  'artisan',
  'starter',
  'standard',
  'pme',
  'professionnel',
  'enterprise',
  'entreprise',
]);

export function isRecognizedPlan(rawPlan?: string | null): boolean {
  const p = (rawPlan || '').trim().toLowerCase();
  return RECOGNIZED_PLAN_CODES.has(p);
}

export function normalizePlan(rawPlan?: string | null): {
  plan: CanonicalPlan;
  wasLegacy: boolean;
} {
  const p = (rawPlan || '').trim().toLowerCase();
  if (p === 'artisan' || p === 'standard' || p === 'starter') return { plan: 'sta', wasLegacy: true };
  if (p === 'pme' || p === 'professionnel') return { plan: 'pro', wasLegacy: true };
  if (p === 'enterprise' || p === 'entreprise') return { plan: 'ent', wasLegacy: true };
  if (p === 'sta') return { plan: 'sta', wasLegacy: false };
  if (p === 'pro') return { plan: 'pro', wasLegacy: false };
  if (p === 'ent') return { plan: 'ent', wasLegacy: false };
  return { plan: 'free', wasLegacy: false };
}

export function plan_limits(planInput?: string | null) {
  const { plan } = normalizePlan(planInput);
  switch (plan) {
    case 'ent':
      return {
        plan: 'ent' as CanonicalPlan,
        max_references: 99999,
        max_depots: 99999,
        max_users: 99999,
        default_modules: ['stock', 'outils', 'formation', 'rapports'] as LicenseModule[],
      };
    case 'pro':
      return {
        plan: 'pro' as CanonicalPlan,
        max_references: 1000,
        max_depots: 10,
        max_users: 99999,
        default_modules: ['stock', 'outils', 'rapports'] as LicenseModule[],
      };
    case 'sta':
      return {
        plan: 'sta' as CanonicalPlan,
        max_references: 300,
        max_depots: 3,
        max_users: 99999,
        default_modules: ['stock'] as LicenseModule[],
      };
    case 'free':
    default:
      return {
        plan: 'free' as CanonicalPlan,
        max_references: 50,
        max_depots: 1,
        max_users: 99999,
        default_modules: ['stock'] as LicenseModule[],
      };
  }
}

export function normalizeModules(rawModules?: unknown, _wasLegacy = false, planInput?: string | null): LicenseModule[] {
  if (Array.isArray(rawModules) && rawModules.length > 0) {
    const filtered = rawModules
      .map((m) => String(m).trim().toLowerCase() as LicenseModule)
      .filter((m): m is LicenseModule => VALID_MODULES.includes(m));
    if (filtered.length > 0) return Array.from(new Set(filtered));
  }
  return plan_limits(planInput).default_modules;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

async function verifyEd25519WithPublicKey(
  message: string,
  signatureHex: string,
  publicKeyB64: string
): Promise<boolean> {
  try {
    const pubDer = Uint8Array.from(atob(publicKeyB64), (c) => c.charCodeAt(0));
    const pubKey = await crypto.subtle.importKey(
      'spki',
      pubDer,
      { name: 'Ed25519' },
      false,
      ['verify']
    );
    const enc = new TextEncoder();
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      pubKey,
      hexToBytes(signatureHex),
      enc.encode(message)
    );
  } catch {
    return false;
  }
}

function extractProjectRef(rawUrl?: string | null): string {
  if (!rawUrl) return 'NONE';
  try {
    const clean = rawUrl.trim().toLowerCase();
    const url = new URL(clean.startsWith('http') ? clean : `https://${clean}`);
    const host = url.hostname.toLowerCase();
    if (host.includes('.supabase.co')) {
      return host.split('.supabase.co')[0];
    }
    if (host.includes('.supabase.in')) {
      return host.split('.supabase.in')[0];
    }
    return host;
  } catch {
    return 'NONE';
  }
}

function normalizeUrl(url?: string | null): string {
  if (!url) return '';
  return url.trim().toLowerCase().replace(/\/+$/, '');
}

export async function handleSyncLicenseRequest(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const authRes = await authenticateCaller(req);
    if (!authRes.ok) return authRes.response;

    const {
      supabaseUrl,
      supabaseAdmin,
      callerPerms,
      isSuperAdmin,
    } = authRes.ctx;

    const body = await req.json().catch(() => ({}));
    if (body?.action === 'ping' || body?.action === 'status') {
      return jsonResponse({ success: true, function: CLIENT_EDGE_FUNCTIONS.syncLicense, status: 'ok' }, 200);
    }

    const canManageLicense =
      isSuperAdmin ||
      callerPerms.includes('*') ||
      callerPerms.includes('perm_config_license') ||
      callerPerms.includes('perm_config_db');

    if (!canManageLicense) {
      return jsonResponse(
        {
          success: false,
          error: 'Accès refusé : la permission perm_config_license (ou rôle 0) est requise pour synchroniser la licence.',
        },
        403
      );
    }

    // Read runtime configuration from app_settings with fallback to embedded key / env vars
    const runtimeCfg = await readRuntimeConfig(supabaseAdmin);

    let token = body?.signed_token || body?.license?.signed_token;

    // Optional binding by license_key when master_license_url is configured (used by tot-install step 6)
    if (!token && body?.license_key && runtimeCfg.masterLicenseUrl) {
      try {
        const masterFnName = (runtimeCfg.masterLicenseFunction || MASTER_EDGE_FUNCTIONS.licenses).trim();
        const masterEndpoint = `${runtimeCfg.masterLicenseUrl.replace(/\/+$/, '')}/functions/v1/${encodeURIComponent(masterFnName)}`;
        const masterResp = await fetch(masterEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'validate',
            license_key: String(body.license_key).trim().toUpperCase(),
            client_supabase_url: supabaseUrl,
          }),
        });
        const masterJson = await masterResp.json().catch(() => ({}));
        if (masterResp.ok && masterJson?.signed_token) {
          token = masterJson.signed_token;
        } else if (masterJson?.error) {
          return jsonResponse({ success: false, error: masterJson.error }, masterResp.status || 400);
        }
      } catch (e: any) {
        return jsonResponse(
          {
            success: false,
            error: `Impossible de contacter le serveur maître des licences : ${e?.message || 'erreur réseau'}`,
          },
          502
        );
      }
    }

    if (!token || !token.license_key || !token.signature) {
      return jsonResponse(
        { success: false, error: 'Jeton de licence signé manquant ou incomplet.' },
        400
      );
    }

    const keyRegistry: Record<string, { kid: string; publicKeyB64: string; retired_at: string | null }> = {
      [runtimeCfg.currentKeyId]: {
        kid: runtimeCfg.currentKeyId,
        publicKeyB64: runtimeCfg.licensePublicKeyB64 || DEFAULT_PUBLIC_KEY_B64,
        retired_at: null,
      },
      [DEFAULT_KEY_ID]: {
        kid: DEFAULT_KEY_ID,
        publicKeyB64: runtimeCfg.licensePublicKeyB64 || DEFAULT_PUBLIC_KEY_B64,
        retired_at: null,
      },
      [LEGACY_KEY_ID]: {
        kid: LEGACY_KEY_ID,
        publicKeyB64: LEGACY_PUBLIC_KEY_B64,
        retired_at: runtimeCfg.legacyKeyRemovedAt,
      },
    };

    const tokenKid = String(token.kid || runtimeCfg.currentKeyId).trim();
    const keyEntry = keyRegistry[tokenKid];
    if (!keyEntry) {
      return jsonResponse(
        {
          success: false,
          error: `Refus de synchronisation : identifiant de clé de signature (kid="${tokenKid}") inconnu ou révoqué.`,
        },
        403
      );
    }

    if (keyEntry.retired_at && Date.now() >= new Date(keyEntry.retired_at).getTime()) {
      return jsonResponse(
        {
          success: false,
          error: `Refus de synchronisation : la clé de signature "${tokenKid}" a été retirée le ${new Date(keyEntry.retired_at).toLocaleDateString('fr-FR')}.`,
        },
        403
      );
    }

    const currentProjectRef = extractProjectRef(supabaseUrl);
    const tokenProjectRef = token.client_project_ref ? token.client_project_ref.trim().toLowerCase() : null;

    if (!tokenProjectRef || tokenProjectRef === 'none') {
      return jsonResponse(
        {
          success: false,
          error: "Refus de synchronisation : le jeton de licence n'est pas lié à un identifiant de projet Supabase client (client_project_ref requis).",
        },
        403
      );
    }

    if (currentProjectRef !== 'none' && tokenProjectRef !== currentProjectRef.toLowerCase()) {
      return jsonResponse(
        {
          success: false,
          error: `Refus de synchronisation : ce jeton est délivré pour le projet "${token.client_project_ref}", mais cette base correspond à "${currentProjectRef}".`,
        },
        403
      );
    }

    if (token.client_supabase_url && supabaseUrl) {
      const normalizedTokenUrl = normalizeUrl(token.client_supabase_url);
      const normalizedCurrentUrl = normalizeUrl(supabaseUrl);
      if (normalizedTokenUrl && normalizedCurrentUrl && normalizedTokenUrl !== normalizedCurrentUrl) {
        return jsonResponse(
          {
            success: false,
            error: `Refus de synchronisation : l'URL de base Supabase du jeton (${token.client_supabase_url}) ne correspond pas à ce projet (${supabaseUrl}).`,
          },
          403
        );
      }
    }

    const now = Date.now();
    if (token.expires_at) {
      const expTime = new Date(token.expires_at).getTime();
      if (now > expTime) {
        return jsonResponse(
          {
            success: false,
            error: `La licence a expiré le ${new Date(expTime).toLocaleDateString('fr-FR')}. Synchronisation refusée.`,
          },
          403
        );
      }
    }

    if (token.offline_until) {
      const offlineTime = new Date(token.offline_until).getTime();
      if (now > offlineTime) {
        return jsonResponse(
          {
            success: false,
            error: `Le délai de grâce hors-ligne (offline_until) a expiré le ${new Date(offlineTime).toLocaleDateString('fr-FR')}. Une validation serveur en ligne est requise.`,
          },
          403
        );
      }
    }

    // Point critique : utiliser la chaîne `plan` exactement telle qu'elle figure dans le jeton pour la vérification de signature,
    // puis normaliser vers le code canonique ('free' | 'sta' | 'pro' | 'ent') après vérification.
    const rawPlanExact = String(token.plan ?? token.plan_type ?? '').trim();
    if (!rawPlanExact || !isRecognizedPlan(rawPlanExact)) {
      return jsonResponse(
        {
          success: false,
          error: `Refus de synchronisation : formule de licence inconnue (${rawPlanExact || 'vide'}).`,
        },
        403
      );
    }

    const rawLimits = plan_limits(rawPlanExact);
    const normalizedModules = normalizeModules(token.modules, false, rawPlanExact);
    const maxDepots = Number(token.max_depots ?? rawLimits.max_depots);
    const clientRefForPayload = token.client_project_ref || extractProjectRef(token.client_supabase_url);

    const payloadV5 = [
      tokenKid,
      String(token.license_key).trim().toUpperCase(),
      rawPlanExact,
      normalizedModules.join(','),
      maxDepots,
      token.organization_name || 'Client',
      clientRefForPayload || 'NONE',
      token.issued_at,
      token.offline_until,
      token.expires_at || 'NONE',
    ].join('|');

    let isValidSig = await verifyEd25519WithPublicKey(payloadV5, token.signature, keyEntry.publicKeyB64);

    if (!isValidSig) {
      const legacyPayload = [
        String(token.license_key).trim().toUpperCase(),
        rawPlanExact,
        maxDepots,
        Number(token.max_references ?? token.max_products ?? token.max_tools ?? rawLimits.max_references),
        token.organization_name || 'Client',
        clientRefForPayload || 'NONE',
        token.issued_at,
        token.offline_until,
        token.expires_at || 'NONE',
      ].join('|');
      isValidSig = await verifyEd25519WithPublicKey(legacyPayload, token.signature, keyEntry.publicKeyB64);
    }

    if (!isValidSig) {
      return jsonResponse(
        {
          success: false,
          error: 'Échec de validation de la licence : La signature asymétrique Ed25519 est invalide ou signée par une clé retirée.',
        },
        403
      );
    }

    // Normalisation vers le code canonique ('free' | 'sta' | 'pro' | 'ent') après validation de la signature
    const { plan: canonicalPlan } = normalizePlan(rawPlanExact);
    const canonicalLimits = plan_limits(canonicalPlan);
    const effectiveMaxDepots =
      maxDepots > 0 ? Math.min(maxDepots, canonicalLimits.max_depots) : canonicalLimits.max_depots;

    const { data: updatedConfig, error: writeErr } = await supabaseAdmin
      .from(TABLES.licenseConfig)
      .upsert(
        {
          id: 'active_license',
          license_key: String(token.license_key).trim().toUpperCase(),
          plan_type: canonicalPlan,
          modules: normalizedModules,
          max_depots: effectiveMaxDepots,
          organization_name: token.organization_name || 'Client',
          signed_token:
            token.raw_token ||
            JSON.stringify({
              ...token,
              kid: tokenKid,
              plan: rawPlanExact,
              plan_type: canonicalPlan,
              max_depots: effectiveMaxDepots,
              modules: normalizedModules,
            }),
          offline_until: token.offline_until || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      .select()
      .single();

    if (writeErr) {
      return jsonResponse(
        { success: false, error: `Erreur écriture license_config : ${writeErr.message}` },
        500
      );
    }

    return jsonResponse(
      {
        success: true,
        message: `Licence ${canonicalPlan.toUpperCase()} (modules : ${normalizedModules.join(', ')}) validée et synchronisée avec succès.`,
        config: updatedConfig,
      },
      200
    );
  } catch (err: any) {
    return jsonResponse({ success: false, error: err?.message || 'Erreur inattendue serveur' }, 500);
  }
}

// -------------------------------------------------------------------------
// Point d'entrée Deno Edge Function
// -------------------------------------------------------------------------
serve(createSyncLicenseHandler());
