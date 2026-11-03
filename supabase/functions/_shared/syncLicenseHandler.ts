import { handleCorsPreflight, jsonResponse } from "./cors.ts";
import { authenticateCaller } from "./auth.ts";
import {
  DEFAULT_KEY_ID,
  LEGACY_KEY_ID,
  DEFAULT_LEGACY_RETIRED_AT,
  DEFAULT_PUBLIC_KEY_B64,
  LEGACY_PUBLIC_KEY_B64,
  readRuntimeConfig,
} from "./config.ts";

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

    const body = await req.json().catch(() => ({}));
    if (body?.action === 'ping' || body?.action === 'status') {
      return jsonResponse({ success: true, function: 'sync-license', status: 'ok' }, 200);
    }

    // Read runtime configuration from app_settings with fallback to embedded key / env vars
    const runtimeCfg = await readRuntimeConfig(supabaseAdmin);

    let token = body?.signed_token || body?.license?.signed_token;

    // Optional binding by license_key when master_license_url is configured (used by tot-install step 6)
    if (!token && body?.license_key && runtimeCfg.masterLicenseUrl) {
      try {
        const masterFnName = (runtimeCfg.masterLicenseFunction || 'APP_TOT-Stock_licenses').trim();
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

    const { data: updatedConfig, error: writeErr } = await supabaseAdmin
      .from('license_config')
      .upsert(
        {
          id: 'active_license',
          license_key: String(token.license_key).trim().toUpperCase(),
          plan_type: canonicalPlan,
          modules: normalizedModules,
          max_depots: maxDepots,
          organization_name: token.organization_name || 'Client',
          signed_token:
            token.raw_token ||
            JSON.stringify({
              ...token,
              kid: tokenKid,
              plan: canonicalPlan,
              plan_type: canonicalPlan,
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
