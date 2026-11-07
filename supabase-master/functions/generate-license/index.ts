import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-api-key',
};

export const CURRENT_KEY_ID =
  Deno.env.get('TOT_STOCK-ED25519_KID') ||
  Deno.env.get('ED25519_KID') ||
  'ed25519-2026-v2';

export type CanonicalPlan = 'free' | 'sta' | 'pro' | 'ent';
export type LicenseModule = 'stock' | 'outils' | 'formation' | 'rapports';
export const VALID_MODULES: LicenseModule[] = ['stock', 'outils', 'formation', 'rapports'];

export function normalizePlan(rawPlan?: string | null, licenseKey?: string | null): {
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
  if (p === 'free' || p === 'gratuit') return { plan: 'free', wasLegacy: false };

  const keyUpper = (licenseKey || '').toUpperCase();
  if (keyUpper.includes('-ARTISAN-')) return { plan: 'sta', wasLegacy: true };
  if (keyUpper.includes('-PME-')) return { plan: 'pro', wasLegacy: true };
  if (keyUpper.includes('-ENTERPRISE-')) return { plan: 'ent', wasLegacy: true };
  if (keyUpper.includes('-STA-')) return { plan: 'sta', wasLegacy: false };
  if (keyUpper.includes('-PRO-')) return { plan: 'pro', wasLegacy: false };
  if (keyUpper.includes('-ENT-')) return { plan: 'ent', wasLegacy: false };

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

export function normalizeModules(
  rawModules?: unknown,
  _wasLegacy = false,
  planInput?: string | null
): LicenseModule[] {
  if (Array.isArray(rawModules) && rawModules.length > 0) {
    const filtered = rawModules
      .map((m) => String(m).trim().toLowerCase() as LicenseModule)
      .filter((m): m is LicenseModule => VALID_MODULES.includes(m));
    if (filtered.length > 0) {
      return Array.from(new Set(filtered));
    }
  }
  return plan_limits(planInput).default_modules;
}

async function checkDatabaseRateLimit(
  supabaseAdmin: any,
  identifier: string,
  windowSeconds = 60,
  maxRequests = 30
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.rpc('check_and_increment_rate_limit', {
      p_identifier: identifier,
      p_window_seconds: windowSeconds,
      p_max_requests: maxRequests,
    });
    if (!error && data && typeof data.allowed === 'boolean') {
      return data.allowed;
    }
    return true;
  } catch (err) {
    console.warn('Erreur vérification rate limit SQL:', err);
    return true;
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

function isSameProjectBinding(boundUrl?: string | null, candidateUrl?: string | null): boolean {
  const a = (boundUrl || '').trim().toLowerCase().replace(/\/+$/, '');
  const b = (candidateUrl || '').trim().toLowerCase().replace(/\/+$/, '');
  if (!a || !b) return false;
  if (a === b) return true;
  const refA = extractProjectRef(a);
  const refB = extractProjectRef(b);
  return refA !== 'NONE' && refB !== 'NONE' && refA === refB;
}

function generateSecureHexSegment(byteLength = 8): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function generateFormattedKey(planCode: CanonicalPlan): string {
  let tag = 'FREE';
  if (planCode === 'sta') tag = 'STA';
  else if (planCode === 'pro') tag = 'PRO';
  else if (planCode === 'ent') tag = 'ENT';

  const seg1 = generateSecureHexSegment(8);
  const seg2 = generateSecureHexSegment(8);
  return `TOT-STOCK-${tag}-${seg1}-${seg2}`;
}

async function logAndNotifyLicenseBinding(
  supabaseAdmin: any,
  params: {
    license_id?: string;
    license_key: string;
    organization_name?: string;
    action_type: 'FIRST_BINDING' | 'ADMIN_REBIND' | 'REBIND_REJECTED' | 'FIRST_BINDING_REJECTED';
    previous_url?: string | null;
    new_url?: string | null;
    performed_by: string;
    client_ip: string;
    message: string;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await supabaseAdmin.from('master_license_binding_logs').insert([
      {
        license_id: params.license_id || null,
        license_key: params.license_key,
        action_type: params.action_type,
        previous_url: params.previous_url || null,
        new_url: params.new_url || null,
        performed_by: params.performed_by,
        client_ip: params.client_ip,
        details: params.details || {},
      },
    ]);
  } catch (err) {
    console.warn('Erreur écriture journal master_license_binding_logs:', err);
  }

  try {
    await supabaseAdmin.from('master_vendor_notifications').insert([
      {
        event_type: params.action_type,
        license_key: params.license_key,
        organization_name: params.organization_name || 'Client',
        client_supabase_url: params.new_url || null,
        previous_url: params.previous_url || null,
        performed_by: params.performed_by,
        message: params.message,
      },
    ]);
  } catch (err) {
    console.warn('Erreur écriture notification éditeur master_vendor_notifications:', err);
  }

  const webhookUrl = Deno.env.get('VENDOR_NOTIFICATION_WEBHOOK_URL');
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: params.action_type,
          license_key: params.license_key,
          organization_name: params.organization_name,
          previous_url: params.previous_url,
          new_url: params.new_url,
          performed_by: params.performed_by,
          client_ip: params.client_ip,
          message: params.message,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (err) {
      console.warn('Erreur envoi webhook notification éditeur:', err);
    }
  }
}

async function signLicenseToken(licenseData: {
  license_key: string;
  plan: CanonicalPlan;
  modules: LicenseModule[];
  max_depots: number;
  organization_name: string;
  client_project_ref?: string;
  client_supabase_url?: string | null;
  expires_at?: string | null;
}) {
  const licensePrivateKeyB64 =
    Deno.env.get('TOT_STOCK-ED25519_PRIVATE_KEY_B64') ||
    Deno.env.get('TOT_STOCK_ED25519_PRIVATE_KEY_B64') ||
    Deno.env.get('ED25519_PRIVATE_KEY_B64') ||
    Deno.env.get('LICENSE_PRIVATE_KEY');
  if (!licensePrivateKeyB64) {
    throw new Error(
      'Configuration serveur manquante : Le secret ED25519_PRIVATE_KEY_B64 (ou TOT_STOCK-ED25519_PRIVATE_KEY_B64) n\'est pas défini dans Supabase secrets.'
    );
  }

  const now = new Date();
  const issuedAt = now.toISOString();
  const offlineUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const clientRef = licenseData.client_project_ref || extractProjectRef(licenseData.client_supabase_url);
  const kid = CURRENT_KEY_ID;
  const cleanModules = normalizeModules(licenseData.modules, false, licenseData.plan);

  const payloadToSign = [
    kid,
    licenseData.license_key.trim().toUpperCase(),
    licenseData.plan,
    cleanModules.join(','),
    licenseData.max_depots,
    licenseData.organization_name || 'Client',
    clientRef || 'NONE',
    issuedAt,
    offlineUntil,
    licenseData.expires_at || 'NONE',
  ].join('|');

  const privKeyDer = Uint8Array.from(atob(licensePrivateKeyB64.trim()), (c) => c.charCodeAt(0));
  const privKey = await crypto.subtle.importKey(
    'pkcs8',
    privKeyDer,
    { name: 'Ed25519' },
    false,
    ['sign']
  );

  const enc = new TextEncoder();
  const sigBuf = await crypto.subtle.sign({ name: 'Ed25519' }, privKey, enc.encode(payloadToSign));
  const signature = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const claims = {
    kid,
    license_key: licenseData.license_key.trim().toUpperCase(),
    organization_name: licenseData.organization_name,
    plan: licenseData.plan,
    plan_type: licenseData.plan,
    modules: cleanModules,
    max_depots: licenseData.max_depots,
    client_project_ref: clientRef !== 'NONE' ? clientRef : null,
    client_supabase_url: licenseData.client_supabase_url || null,
    issued_at: issuedAt,
    expires_at: licenseData.expires_at || null,
    offline_until: offlineUntil,
    token_version: 5,
    algorithm: 'Ed25519',
  };

  const payloadB64 = btoa(JSON.stringify(claims));
  const rawToken = `${payloadB64}.${signature}`;

  return {
    ...claims,
    signature,
    raw_token: rawToken,
  };
}

async function verifyVendorAdmin(req: Request, supabaseAdmin: any): Promise<boolean> {
  const masterApiKey =
    Deno.env.get('TOT_STOCK-MASTER_ADMIN_SECRET') ||
    Deno.env.get('TOT_STOCK_MASTER_ADMIN_SECRET') ||
    Deno.env.get('MASTER_ADMIN_SECRET') ||
    Deno.env.get('MASTER_ADMIN_API_KEY');
  const callerApiKey = req.headers.get('x-admin-api-key');
  if (masterApiKey && callerApiKey && masterApiKey.trim() === callerApiKey.trim()) {
    return true;
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return false;

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return false;

  const masterVendorEmails = (Deno.env.get('VENDOR_ADMIN_EMAILS') || '')
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);

  if (masterVendorEmails.length > 0 && user.email && masterVendorEmails.includes(user.email.toLowerCase())) {
    return true;
  }

  if (user.app_metadata?.is_vendor_admin === true || user.app_metadata?.role === 'super_admin') {
    return true;
  }

  // v45 : la base maître n'a pas de table de profils (users / core_users).
  // Les administrateurs éditeur sont reconnus uniquement par VENDOR_ADMIN_EMAILS
  // ou par app_metadata (is_vendor_admin / role = super_admin).

  return false;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      Deno.env.get('TOT_STOCK-SERVICE_ROLE_KEY') ||
      Deno.env.get('TOT_STOCK_SERVICE_ROLE_KEY') ||
      '';
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceRoleKey
    );

    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('cf-connecting-ip') ||
      'anonymous-ip';

    const ipAllowed = await checkDatabaseRateLimit(supabaseAdmin, `ip:${clientIp}`, 60, 40);
    if (!ipAllowed) {
      return new Response(
        JSON.stringify({ success: false, error: 'Trop de requêtes. Veuillez patienter une minute avant de réessayer.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const {
      action,
      organization_name,
      client_supabase_url,
      plan_type,
      plan,
      modules: requestedModules,
      license_key: existingKey,
      contact_email,
      binding_allowed: requestedBindingAllowed,
      allow_rebind,
    } = body;

    if (existingKey) {
      const cleanKey = String(existingKey).trim().toUpperCase();
      const keyAllowed = await checkDatabaseRateLimit(supabaseAdmin, `key:${cleanKey}`, 60, 20);
      if (!keyAllowed) {
        return new Response(
          JSON.stringify({ success: false, error: 'Trop de tentatives pour cette clé de licence. Veuillez patienter.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
        );
      }
    }

    const isVendorAdmin = await verifyVendorAdmin(req, supabaseAdmin);
    const { plan: requestedCanonicalPlan } = normalizePlan(plan || plan_type || 'free');
    const isPaidPlanRequested = requestedCanonicalPlan !== 'free';

    if (isPaidPlanRequested && !isVendorAdmin) {
      if (action === 'upgrade' || action === 'create') {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Attribution de forfait payant refusée : seuls les administrateurs éditeur de la base maître peuvent octroyer une formule payante (sta, pro, ent).',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
        );
      }
    }

    const authorizedPlan: CanonicalPlan = isVendorAdmin && isPaidPlanRequested ? requestedCanonicalPlan : 'free';
    const limits = plan_limits(authorizedPlan);

    // -------------------------------------------------------------
    // CASE 0: VALIDATE
    // -------------------------------------------------------------
    if (action === 'validate') {
      const cleanKey = (existingKey || '').trim().toUpperCase();
      const cleanClientUrl = (client_supabase_url || '').trim();

      if (!cleanKey || !cleanClientUrl) {
        return new Response(
          JSON.stringify({
            success: false,
            message: 'La clé de licence (license_key) et l\'adresse du projet Supabase client (client_supabase_url) sont toutes deux obligatoires.',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }

      const { data: found, error: findErr } = await supabaseAdmin
        .from('APP_TOT-Stock-licenses')
        .select('*')
        .ilike('license_key', cleanKey)
        .maybeSingle();

      if (findErr) throw findErr;

      if (!found) {
        return new Response(
          JSON.stringify({
            success: false,
            message: `Licence "${cleanKey}" inconnue ou invalide.`,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
        );
      }

      if (found.is_active === false || found.revoked_at) {
        return new Response(
          JSON.stringify({
            success: false,
            message: 'Cette licence a été révoquée par l\'administrateur éditeur.',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
        );
      }

      if (found.expires_at && new Date(found.expires_at).getTime() < Date.now()) {
        return new Response(
          JSON.stringify({
            success: false,
            message: `Cette licence a expiré le ${new Date(found.expires_at).toLocaleDateString('fr-FR')}.`,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
        );
      }

      const existingBoundUrl = (found.client_supabase_url || '').trim();

      if (!existingBoundUrl) {
        if (found.binding_allowed !== true && !isVendorAdmin) {
          await logAndNotifyLicenseBinding(supabaseAdmin, {
            license_id: found.id,
            license_key: found.license_key,
            organization_name: found.organization_name,
            action_type: 'FIRST_BINDING_REJECTED',
            previous_url: null,
            new_url: cleanClientUrl,
            performed_by: 'client_unapproved',
            client_ip: clientIp,
            message: `Refus de première liaison pour la licence ${found.license_key} vers ${cleanClientUrl} : binding_allowed est false.`,
          });

          return new Response(
            JSON.stringify({
              success: false,
              message: 'Première liaison refusée : la liaison de cette licence à une adresse de projet n\'a pas été autorisée par l\'administrateur éditeur (binding_allowed = false).',
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
          );
        }

        const nowIso = new Date().toISOString();
        const bindUpdates: Record<string, any> = {
          client_supabase_url: cleanClientUrl,
          binding_allowed: false,
          bound_at: nowIso,
          bound_by: isVendorAdmin ? 'vendor_admin' : 'client_authorized_first_bind',
          last_verified_at: nowIso,
        };
        if (contact_email && contact_email.trim() && !found.contact_email) {
          bindUpdates.contact_email = contact_email.trim();
        }

        await supabaseAdmin
          .from('APP_TOT-Stock-licenses')
          .update(bindUpdates)
          .eq('id', found.id);

        found.client_supabase_url = cleanClientUrl;
        found.binding_allowed = false;
        found.bound_at = nowIso;

        await logAndNotifyLicenseBinding(supabaseAdmin, {
          license_id: found.id,
          license_key: found.license_key,
          organization_name: found.organization_name,
          action_type: 'FIRST_BINDING',
          previous_url: null,
          new_url: cleanClientUrl,
          performed_by: bindUpdates.bound_by,
          client_ip: clientIp,
          message: `Première liaison effectuée pour la licence ${found.license_key} (${found.organization_name}) sur le projet ${cleanClientUrl}.`,
        });
      } else if (!isSameProjectBinding(existingBoundUrl, cleanClientUrl)) {
        if (!isVendorAdmin || allow_rebind !== true) {
          await logAndNotifyLicenseBinding(supabaseAdmin, {
            license_id: found.id,
            license_key: found.license_key,
            organization_name: found.organization_name,
            action_type: 'REBIND_REJECTED',
            previous_url: existingBoundUrl,
            new_url: cleanClientUrl,
            performed_by: 'unauthorized_client',
            client_ip: clientIp,
            message: `Tentative de re-liaison refusée pour la licence ${found.license_key} : déjà liée à ${existingBoundUrl}, tentative depuis ${cleanClientUrl}.`,
          });

          return new Response(
            JSON.stringify({
              success: false,
              message: `Validation refusée : cette licence est déjà liée à un autre projet Supabase (${existingBoundUrl}). Toute re-liaison ultérieure est strictement réservée à l'administrateur éditeur.`,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
          );
        }

        const nowIso = new Date().toISOString();
        await supabaseAdmin
          .from('APP_TOT-Stock-licenses')
          .update({
            client_supabase_url: cleanClientUrl,
            binding_allowed: false,
            bound_at: nowIso,
            bound_by: 'vendor_admin',
            last_verified_at: nowIso,
          })
          .eq('id', found.id);

        found.client_supabase_url = cleanClientUrl;
        found.binding_allowed = false;
        found.bound_at = nowIso;

        await logAndNotifyLicenseBinding(supabaseAdmin, {
          license_id: found.id,
          license_key: found.license_key,
          organization_name: found.organization_name,
          action_type: 'ADMIN_REBIND',
          previous_url: existingBoundUrl,
          new_url: cleanClientUrl,
          performed_by: 'vendor_admin',
          client_ip: clientIp,
          message: `Re-liaison administrateur éditeur effectuée pour la licence ${found.license_key} : ${existingBoundUrl} -> ${cleanClientUrl}.`,
        });
      } else {
        await supabaseAdmin
          .from('APP_TOT-Stock-licenses')
          .update({ last_verified_at: new Date().toISOString() })
          .eq('id', found.id);
      }

      const { plan: canonicalPlan, wasLegacy } = normalizePlan(found.plan_type, found.license_key);
      const rowLimits = plan_limits(canonicalPlan);
      const modules = normalizeModules(found.modules, wasLegacy, canonicalPlan);
      const pDepots = Number(found.max_depots) || rowLimits.max_depots;
      const clientRef = extractProjectRef(found.client_supabase_url);

      if (wasLegacy) {
        await supabaseAdmin
          .from('APP_TOT-Stock-licenses')
          .update({ plan_type: canonicalPlan, modules })
          .eq('id', found.id);
        found.plan_type = canonicalPlan;
        found.modules = modules;
      }

      const signedToken = await signLicenseToken({
        license_key: found.license_key,
        plan: canonicalPlan,
        modules,
        max_depots: pDepots,
        organization_name: found.organization_name || 'Client Partenaire',
        client_project_ref: clientRef,
        client_supabase_url: found.client_supabase_url,
        expires_at: found.expires_at || null,
      });

      const sanitizedLicense = {
        id: found.id,
        license_key: found.license_key,
        plan: canonicalPlan,
        plan_type: canonicalPlan,
        modules,
        max_depots: pDepots,
        organization_name: found.organization_name,
        client_supabase_url: found.client_supabase_url,
        contact_email: found.contact_email,
        billing_cycle: found.billing_cycle,
        is_active: found.is_active !== false,
        expires_at: found.expires_at || null,
        created_at: found.created_at,
        last_verified_at: new Date().toISOString(),
      };

      return new Response(
        JSON.stringify({
          success: true,
          license: sanitizedLicense,
          signed_token: signedToken,
          message: `Licence ${canonicalPlan.toUpperCase()} validée avec succès par le serveur maître.`,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // -------------------------------------------------------------
    // CASE 1: REBIND / AUTHORIZE BINDING (Vendor Admin Only)
    // -------------------------------------------------------------
    if (action === 'rebind') {
      if (!isVendorAdmin) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Opération refusée : toute re-liaison ou autorisation de liaison est strictement réservée à l\'administrateur éditeur.',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
        );
      }

      const cleanKey = (existingKey || '').trim().toUpperCase();
      if (!cleanKey) {
        return new Response(
          JSON.stringify({ success: false, error: 'Clé de licence (license_key) requise.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }

      const { data: found } = await supabaseAdmin
        .from('APP_TOT-Stock-licenses')
        .select('*')
        .ilike('license_key', cleanKey)
        .maybeSingle();

      if (!found) {
        return new Response(
          JSON.stringify({ success: false, error: `Licence "${cleanKey}" introuvable.` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
        );
      }

      const previousUrl = found.client_supabase_url || null;
      const newUrl = client_supabase_url !== undefined ? String(client_supabase_url).trim() : previousUrl;
      const nowIso = new Date().toISOString();

      const updateFields: Record<string, any> = {
        client_supabase_url: newUrl || '',
        binding_allowed: typeof requestedBindingAllowed === 'boolean' ? requestedBindingAllowed : !newUrl,
        bound_at: newUrl ? nowIso : null,
        bound_by: 'vendor_admin',
        updated_at: nowIso,
      };

      const { data: updated, error: updErr } = await supabaseAdmin
        .from('APP_TOT-Stock-licenses')
        .update(updateFields)
        .eq('id', found.id)
        .select()
        .single();

      if (updErr) throw updErr;

      await logAndNotifyLicenseBinding(supabaseAdmin, {
        license_id: found.id,
        license_key: found.license_key,
        organization_name: found.organization_name,
        action_type: 'ADMIN_REBIND',
        previous_url: previousUrl,
        new_url: newUrl,
        performed_by: 'vendor_admin',
        client_ip: clientIp,
        message: `Re-liaison administrateur éditeur sur la licence ${found.license_key} : "${previousUrl || 'aucune'}" -> "${newUrl || 'aucune'}" (binding_allowed=${updateFields.binding_allowed}).`,
      });

      return new Response(
        JSON.stringify({
          success: true,
          license: updated,
          message: 'Liaison de la licence mise à jour et journalisée par l\'administrateur éditeur.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // -------------------------------------------------------------
    // CASE 2: UPDATE CONTACT EMAIL (Exige la clé de licence)
    // -------------------------------------------------------------
    if (action === 'update_contact') {
      const cleanKey = (existingKey || '').trim().toUpperCase();
      if (!cleanKey || cleanKey === 'TOT-STOCK-FREE-COMMUNITY' || cleanKey.startsWith('TOT-STOCK-FREE')) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Une clé de licence valide est exigée pour mettre à jour l\'e-mail de contact.',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }

      if (!contact_email || !String(contact_email).trim().includes('@')) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Veuillez fournir une adresse e-mail de contact valide.',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }

      const { data: found } = await supabaseAdmin
        .from('APP_TOT-Stock-licenses')
        .select('*')
        .ilike('license_key', cleanKey)
        .maybeSingle();

      if (!found || found.is_active === false) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Clé de licence introuvable ou inactive.',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
        );
      }

      if (found.client_supabase_url && found.client_supabase_url.trim() && !isVendorAdmin) {
        if (!client_supabase_url || !isSameProjectBinding(found.client_supabase_url, client_supabase_url)) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'Accès refusé : l\'adresse du projet Supabase ne correspond pas à la licence indiquée.',
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
          );
        }
      }

      const updatePayload: Record<string, any> = {
        contact_email: String(contact_email).trim().toLowerCase(),
        updated_at: new Date().toISOString(),
      };
      if (organization_name && String(organization_name).trim()) {
        updatePayload.organization_name = String(organization_name).trim();
      }

      await supabaseAdmin
        .from('APP_TOT-Stock-licenses')
        .update(updatePayload)
        .eq('id', found.id);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Adresse e-mail de contact associée à la licence avec succès.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // -------------------------------------------------------------
    // CASE 3: UPGRADE / UPDATE (Vendor Admin Only)
    // -------------------------------------------------------------
    if (existingKey) {
      if (!isVendorAdmin) {
        return new Response(
          JSON.stringify({ success: false, error: 'Mise à niveau réservée aux administrateurs éditeur de la base maître.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
        );
      }

      const cleanKey = existingKey.trim().toUpperCase();
      const targetModules = normalizeModules(requestedModules, false, authorizedPlan);
      const updatePayload: Record<string, any> = {
        plan_type: authorizedPlan,
        modules: targetModules,
        max_depots: limits.max_depots,
        is_active: true,
      };
      if (organization_name && organization_name.trim()) updatePayload.organization_name = organization_name.trim();
      if (typeof requestedBindingAllowed === 'boolean') updatePayload.binding_allowed = requestedBindingAllowed;

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('APP_TOT-Stock-licenses')
        .update(updatePayload)
        .ilike('license_key', cleanKey)
        .select()
        .maybeSingle();

      if (updateErr) throw updateErr;

      if (updated) {
        const clientRef = extractProjectRef(updated.client_supabase_url);
        const signedToken = await signLicenseToken({
          license_key: updated.license_key,
          plan: authorizedPlan,
          modules: targetModules,
          max_depots: limits.max_depots,
          organization_name: updated.organization_name,
          client_project_ref: clientRef,
          client_supabase_url: updated.client_supabase_url,
          expires_at: updated.expires_at || null,
        });

        return new Response(
          JSON.stringify({
            success: true,
            action: 'upgrade',
            message: `Licence mise à niveau vers la formule ${authorizedPlan.toUpperCase()} !`,
            license: {
              ...updated,
              plan: authorizedPlan,
              plan_type: authorizedPlan,
              modules: targetModules,
            },
            signed_token: signedToken,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }
    }

    // -------------------------------------------------------------
    // CASE 4: CRÉATION DE LICENCE (Réservée à l'administrateur éditeur)
    // -------------------------------------------------------------
    if (!isVendorAdmin) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Création de licence refusée : seul l\'administrateur éditeur peut émettre de nouvelles licences sur la base maître.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    const orgName = (organization_name || '').trim() || 'Organisation Client';
    const clientUrl = (client_supabase_url || '').trim() || '';
    const newLicenseKey = generateFormattedKey(authorizedPlan);
    const assignedModules = normalizeModules(requestedModules, false, authorizedPlan);
    const bindingAllowed = typeof requestedBindingAllowed === 'boolean' ? requestedBindingAllowed : !clientUrl;

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('APP_TOT-Stock-licenses')
      .insert([
        {
          organization_name: orgName,
          client_supabase_url: clientUrl,
          binding_allowed: bindingAllowed,
          bound_at: clientUrl ? new Date().toISOString() : null,
          bound_by: clientUrl ? 'vendor_admin' : null,
          license_key: newLicenseKey,
          plan_type: authorizedPlan,
          modules: assignedModules,
          max_depots: limits.max_depots,
          contact_email: contact_email?.trim() || null,
          is_active: true,
        },
      ])
      .select()
      .single();

    if (insertErr) throw insertErr;

    if (clientUrl) {
      await logAndNotifyLicenseBinding(supabaseAdmin, {
        license_id: inserted.id,
        license_key: newLicenseKey,
        organization_name: orgName,
        action_type: 'FIRST_BINDING',
        previous_url: null,
        new_url: clientUrl,
        performed_by: 'vendor_admin',
        client_ip: clientIp,
        message: `Licence ${newLicenseKey} créée et liée initialement au projet ${clientUrl} par l'administrateur éditeur.`,
      });
    }

    const clientRef = extractProjectRef(clientUrl);
    const signedToken = await signLicenseToken({
      license_key: newLicenseKey,
      plan: authorizedPlan,
      modules: assignedModules,
      max_depots: limits.max_depots,
      organization_name: orgName,
      client_project_ref: clientRef,
      client_supabase_url: clientUrl || null,
    });

    return new Response(
      JSON.stringify({
        success: true,
        action: 'created',
        message: `Licence ${authorizedPlan.toUpperCase()} créée avec succès pour ${orgName}`,
        license: {
          ...inserted,
          plan: authorizedPlan,
          plan_type: authorizedPlan,
          modules: assignedModules,
        },
        signed_token: signedToken,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || 'Erreur lors du traitement de la licence côté serveur' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
