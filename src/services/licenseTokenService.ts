import {
  CanonicalLicensePlan,
  LicenseModule,
  ALL_LICENSE_MODULES,
  SignedLicenseToken,
  isRecognizedLicensePlan,
  normalizeToCanonicalPlan,
  plan_limits,
} from '../types';
export { plan_limits };
import { SupabaseClient } from '@supabase/supabase-js';
import { TABLES } from '../constants/tables';
import {
  getResolvedEdgeFunctionName,
  loadEdgeFunctionOverridesFromClientDb,
  extractEdgeFunctionErrorDetails,
} from '../constants/edgeFunctions';

// Public asymmetric verification key for TOT Stock License (Ed25519 SPKI format)
// Client CANNOT forge signatures with this key: only the server private key (ED25519_PRIVATE_KEY_B64) can sign.
export const TOT_STOCK_LICENSE_PUBLIC_KEY = 'MCowBQYDK2VwAyEA9n369nlU8Fi6exT4nTAtcA/r7ym7OtRVhZbxxKwCbfw=';
export const CURRENT_KEY_ID = 'ed25519-2026-v2';
export const LEGACY_KEY_ID = 'ed25519-2025-v1';
export const LEGACY_KEY_RETIRED_AT = '2026-01-01T00:00:00.000Z';
export const OFFLINE_TOKEN_VALIDITY_DAYS = 7;

export interface SigningKeyMetadata {
  kid: string;
  publicKeyB64: string;
  retired_at: string | null;
}

export const LICENSE_SIGNING_KEYS: Record<string, SigningKeyMetadata> = {
  [CURRENT_KEY_ID]: {
    kid: CURRENT_KEY_ID,
    publicKeyB64: TOT_STOCK_LICENSE_PUBLIC_KEY,
    retired_at: null,
  },
  [LEGACY_KEY_ID]: {
    kid: LEGACY_KEY_ID,
    publicKeyB64: 'MCowBQYDK2VwAyEAEqb3vlPKty9AMvJEODxOX3YzZZS/xCcSWTYTkA20dZQ=',
    retired_at: LEGACY_KEY_RETIRED_AT,
  },
};

/**
 * Converts a hex string into a Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Normalise un jeton ou objet de claims (y compris les alias artisan, pme, enterprise) vers le format canonique :
 * - plan : 'free' | 'sta' | 'pro' | 'ent'
 * - modules : liste validée ou modules par défaut de la formule
 * - max_references et max_tools sont retirés
 */
export function convertLegacyLicenseToken(rawClaims: Record<string, any>): SignedLicenseToken {
  const rawPlanStr = String(rawClaims.plan || rawClaims.plan_type || 'free').trim().toLowerCase();
  const canonicalPlan: CanonicalLicensePlan = normalizeToCanonicalPlan(rawPlanStr, rawClaims.license_key);
  const limits = plan_limits(canonicalPlan);

  let normalizedModules: LicenseModule[] = limits.default_modules;
  if (Array.isArray(rawClaims.modules) && rawClaims.modules.length > 0) {
    const valid = rawClaims.modules
      .map((m: unknown) => String(m).trim().toLowerCase() as LicenseModule)
      .filter((m: LicenseModule) => ALL_LICENSE_MODULES.includes(m));
    if (valid.length > 0) {
      normalizedModules = Array.from(new Set(valid));
    }
  }

  const maxDepots = Number(rawClaims.max_depots) > 0 ? Number(rawClaims.max_depots) : limits.max_depots;

  const converted: SignedLicenseToken = {
    kid: String(rawClaims.kid || CURRENT_KEY_ID),
    license_key: String(rawClaims.license_key || '').trim().toUpperCase(),
    organization_name: rawClaims.organization_name || 'Client',
    client_project_ref: rawClaims.client_project_ref,
    client_supabase_url: rawClaims.client_supabase_url,
    plan: canonicalPlan,
    plan_type: canonicalPlan,
    modules: normalizedModules,
    max_depots: maxDepots,
    issued_at: rawClaims.issued_at || new Date().toISOString(),
    expires_at: rawClaims.expires_at ?? null,
    offline_until: rawClaims.offline_until || new Date(Date.now() + OFFLINE_TOKEN_VALIDITY_DAYS * 86400000).toISOString(),
    signature: String(rawClaims.signature || ''),
    token_version: Number(rawClaims.token_version || 5),
    raw_token: String(rawClaims.raw_token || ''),
  };

  // Retrait explicite de max_references et max_tools s'ils figuraient dans un ancien objet
  delete (converted as any).max_references;
  delete (converted as any).max_tools;

  return converted;
}

/**
 * Verifies an Asymmetric Ed25519 signature in browser / WebCrypto environment
 * strictly against the active key matching kid (rejects any retired key).
 */
export async function verifyEd25519Signature(
  message: string,
  signatureHex: string,
  kid = CURRENT_KEY_ID
): Promise<boolean> {
  const keyMeta = LICENSE_SIGNING_KEYS[kid];
  if (!keyMeta) return false;

  // Refuser systématiquement toute clé dont la date de retrait est échue
  if (keyMeta.retired_at && Date.now() >= new Date(keyMeta.retired_at).getTime()) {
    return false;
  }

  try {
    const subtle =
      typeof window !== 'undefined' && window.crypto?.subtle
        ? window.crypto.subtle
        : globalThis.crypto?.subtle;
    if (!subtle) return false;

    const pubDer = Uint8Array.from(atob(keyMeta.publicKeyB64), (c) => c.charCodeAt(0));
    const pubKey = await subtle.importKey(
      'spki',
      pubDer,
      { name: 'Ed25519' },
      false,
      ['verify']
    );

    const enc = new TextEncoder();
    const msgBytes = enc.encode(message);
    const sigBytes = hexToBytes(signatureHex);

    return await subtle.verify(
      { name: 'Ed25519' },
      pubKey,
      sigBytes as unknown as BufferSource,
      msgBytes as unknown as BufferSource
    );
  } catch {
    return false;
  }
}

export function extractProjectRef(urlOrRef?: string): string | null {
  if (!urlOrRef) return null;
  const clean = urlOrRef.trim().toLowerCase();
  const match = clean.match(/(?:https?:\/\/)?([a-zA-Z0-9_-]+)(?:\.supabase\.(?:co|in))/);
  if (match && match[1]) return match[1];
  if (/^[a-zA-Z0-9_-]{10,30}$/.test(clean)) return clean;
  try {
    const url = new URL(clean.startsWith('http://') || clean.startsWith('https://') ? clean : `https://${clean}`);
    if (url.hostname) return url.hostname.toLowerCase();
  } catch {
    const hostPart = clean.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
    if (hostPart) return hostPart.toLowerCase();
  }
  return null;
}

/**
 * Verifies a Signed License Token against asymmetric Ed25519 cryptographic signature,
 * key retirement status (kid), project binding, and offline expiration.
 *
 * Point critique : lors de la vérification de la signature, la chaîne `plan` est utilisée
 * exactement telle qu'elle figure dans le jeton, puis normalisée vers le code canonique
 * ('free' | 'sta' | 'pro' | 'ent') uniquement après la vérification de la signature.
 */
export async function verifySignedLicenseToken(
  token: SignedLicenseToken | Record<string, any> | string,
  expectedSupabaseUrlOrRef?: string
): Promise<{ valid: boolean; token?: SignedLicenseToken; reason?: string }> {
  try {
    let rawClaims: Record<string, any>;
    let rawTokenStr = '';

    if (typeof token === 'string') {
      rawTokenStr = token.trim();
      const parts = rawTokenStr.split('.');
      if (parts.length !== 2) {
        return { valid: false, reason: 'Format de jeton invalide (doit être payload.signature).' };
      }
      const [payloadB64, sig] = parts;
      const jsonStr =
        typeof atob !== 'undefined'
          ? decodeURIComponent(escape(atob(payloadB64)))
          : Buffer.from(payloadB64, 'base64').toString('utf-8');
      const claims = JSON.parse(jsonStr);
      rawClaims = {
        ...claims,
        signature: sig,
        raw_token: rawTokenStr,
      };
    } else {
      rawClaims = { ...token };
      rawTokenStr = rawClaims.raw_token || '';
    }

    // 1. Vérification de l'identifiant de clé (kid) et de sa date de retrait
    const tokenKid = String(rawClaims.kid || CURRENT_KEY_ID).trim();
    const keyMeta = LICENSE_SIGNING_KEYS[tokenKid];
    if (!keyMeta) {
      return {
        valid: false,
        reason: `Identifiant de clé de signature inconnu (${tokenKid}).`,
      };
    }

    if (keyMeta.retired_at && Date.now() >= new Date(keyMeta.retired_at).getTime()) {
      return {
        valid: false,
        reason: `Jeton refusé : la clé de signature "${tokenKid}" a été retirée le ${new Date(keyMeta.retired_at).toLocaleDateString('fr-FR')}.`,
      };
    }

    // 2. Vérifier que la formule brute figurant dans le jeton est reconnue (code canonique ou alias en lecture)
    const rawPlanExact = String(rawClaims.plan ?? rawClaims.plan_type ?? '').trim();
    if (!rawPlanExact || !isRecognizedLicensePlan(rawPlanExact)) {
      return {
        valid: false,
        reason: `Formule de licence inconnue ou non autorisée dans le jeton (${rawPlanExact || 'vide'}).`,
      };
    }

    const rawLicenseKey = String(rawClaims.license_key || '').trim().toUpperCase();
    const rawOrgName = rawClaims.organization_name || 'Client';
    const clientRef = String(rawClaims.client_project_ref || 'NONE');
    const issuedAt = String(rawClaims.issued_at || '');
    const offlineUntil = String(rawClaims.offline_until || '');
    const expiresAt = rawClaims.expires_at ?? null;
    const signature = String(rawClaims.signature || '');

    // Modules et max_depots tels qu'inscrits dans le jeton pour la vérification cryptographique
    const rawLimits = plan_limits(rawPlanExact);
    let rawModulesForSig: string[] = rawLimits.default_modules;
    if (Array.isArray(rawClaims.modules) && rawClaims.modules.length > 0) {
      const validMods = rawClaims.modules
        .map((m: unknown) => String(m).trim().toLowerCase() as LicenseModule)
        .filter((m: LicenseModule) => ALL_LICENSE_MODULES.includes(m));
      if (validMods.length > 0) {
        rawModulesForSig = Array.from(new Set(validMods));
      }
    }
    const rawMaxDepots = Number(rawClaims.max_depots) > 0 ? Number(rawClaims.max_depots) : rawLimits.max_depots;

    // 3. Verify offline date has not elapsed
    const now = Date.now();
    if (offlineUntil) {
      const offlineExpiry = new Date(offlineUntil).getTime();
      if (now > offlineExpiry) {
        const parsedExpired = convertLegacyLicenseToken({ ...rawClaims, kid: tokenKid, raw_token: rawTokenStr });
        return {
          valid: false,
          token: parsedExpired,
          reason: `L'autorisation hors-ligne (+${OFFLINE_TOKEN_VALIDITY_DAYS} jours) a expiré le ${new Date(offlineExpiry).toLocaleDateString('fr-FR')}. Une validation serveur en ligne est requise.`,
        };
      }
    }

    // 4. Verify global expiration date if present
    if (expiresAt) {
      const exp = new Date(expiresAt).getTime();
      if (now > exp) {
        const parsedExpired = convertLegacyLicenseToken({ ...rawClaims, kid: tokenKid, raw_token: rawTokenStr });
        return {
          valid: false,
          token: parsedExpired,
          reason: `La licence a expiré le ${new Date(exp).toLocaleDateString('fr-FR')}.`,
        };
      }
    }

    // 5. Verify client_project_ref is present
    if (!rawClaims.client_project_ref || clientRef.trim().toLowerCase() === 'none') {
      return {
        valid: false,
        reason: 'Jeton de licence invalide : Le paramètre client_project_ref est manquant ou non lié.',
      };
    }

    // 6. Verify asymmetric Ed25519 signature using rawPlanExact EXACTEMENT telle qu'elle figure dans le jeton
    const payloadV5 = [
      tokenKid,
      rawLicenseKey,
      rawPlanExact,
      rawModulesForSig.join(','),
      rawMaxDepots,
      rawOrgName,
      clientRef,
      issuedAt,
      offlineUntil,
      expiresAt || 'NONE',
    ].join('|');

    let isValid = await verifyEd25519Signature(payloadV5, signature, tokenKid);

    // Rétrocompatibilité v4 (anciens jetons sans kid ni modules dans le payload signé)
    if (!isValid) {
      const legacyMaxQuota = Number(
        rawClaims.max_references ?? rawClaims.max_products ?? rawClaims.max_tools ?? rawLimits.max_references
      );
      const payloadV4 = [
        rawLicenseKey,
        rawPlanExact,
        rawMaxDepots,
        legacyMaxQuota,
        rawOrgName,
        clientRef,
        issuedAt,
        offlineUntil,
        expiresAt || 'NONE',
      ].join('|');
      isValid = await verifyEd25519Signature(payloadV4, signature, tokenKid);
    }

    if (!isValid) {
      return {
        valid: false,
        reason: 'Signature cryptographique asymétrique Ed25519 invalide ou signée par une clé retirée.',
      };
    }

    // 7. Normalisation vers le code canonique ('free' | 'sta' | 'pro' | 'ent') UNIQUEMENT après vérification de la signature
    const parsed = convertLegacyLicenseToken({ ...rawClaims, kid: tokenKid, raw_token: rawTokenStr });

    // 8. Verify binding to current client project ref if supplied
    if (expectedSupabaseUrlOrRef) {
      const currentRef = extractProjectRef(expectedSupabaseUrlOrRef);
      if (
        currentRef &&
        parsed.client_project_ref &&
        parsed.client_project_ref !== 'NONE' &&
        parsed.client_project_ref.toLowerCase() !== currentRef.toLowerCase()
      ) {
        return {
          valid: false,
          token: parsed,
          reason: `Cette licence est liée au projet Supabase "${parsed.client_project_ref}" et ne peut pas être utilisée sur "${currentRef}".`,
        };
      }
    }

    return { valid: true, token: parsed };
  } catch (err) {
    return { valid: false, reason: `Erreur lors de la vérification du jeton : ${err}` };
  }
}

/**
 * Synchronizes the active Signed License Token to Client Supabase DB via the client license Edge Function
 */
export async function syncLicenseTokenToClientDb(
  client: SupabaseClient,
  signedToken: SignedLicenseToken
): Promise<{
  success: boolean;
  status?: number;
  code?: string;
  isNotFound?: boolean;
  message: string;
}> {
  await loadEdgeFunctionOverridesFromClientDb(client);
  const fnName = getResolvedEdgeFunctionName('syncLicense');

  try {
    const { data, error } = await client.functions.invoke(fnName, {
      body: { signed_token: signedToken },
    });

    if (!error && data?.success === true) {
      return {
        success: true,
        status: 200,
        message: data.message || `Jeton de licence signé synchronisé avec succès via ${fnName}.`,
      };
    }

    const parsed = await extractEdgeFunctionErrorDetails(error, data);
    const status = parsed.status || (error ? 500 : 400);
    const rawMsg = parsed.message;

    if (
      parsed.isNotFound ||
      (!error?.context?.status && (error as any)?.name === 'FunctionsFetchError')
    ) {
      return {
        success: false,
        status: 404,
        code: 'NOT_FOUND',
        isNotFound: true,
        message: `Fonction Edge "${fnName}" introuvable (404) : vérifiez le nom exact déployé sur votre projet Supabase client.`,
      };
    }

    if (status === 403 || status === 401) {
      return {
        success: false,
        status,
        code: parsed.code || 'FORBIDDEN',
        isNotFound: false,
        message: rawMsg
          ? `Refusé par ${fnName} (${status}) : ${rawMsg}`
          : `Refusé par ${fnName} (${status}) : signature Ed25519 invalide, permission insuffisante ou projet non concordant.`,
      };
    }

    if (status >= 500) {
      return {
        success: false,
        status,
        code: parsed.code || 'SERVER_ERROR',
        isNotFound: false,
        message: rawMsg
          ? `Erreur d'écriture ${fnName} (${status}) : ${rawMsg}`
          : `Erreur d'écriture ${fnName} (${status}) : impossible d'écrire dans core_license_config.`,
      };
    }

    return {
      success: false,
      status,
      code: parsed.code,
      isNotFound: false,
      message: rawMsg || `Échec de synchronisation via ${fnName}`,
    };
  } catch (err: any) {
    return {
      success: false,
      status: 500,
      message: `Erreur communication ${fnName} : ${err?.message || err}`,
    };
  }
}

/**
 * Generates SQL migration for Model B (read-only license_config table for client, managed by the license sync Edge Function,
 * technical ceilings computed via plan_limits(plan), never stored per client)
 */
export function generateModelBSqlMigration(): string {
  return `-- =========================================================================
-- TOT STOCK PRO - MIGRATION MODÈLE B : CONFIGURATION LICENCE & FONCTION plan_limits(plan)
-- Table license_config en lecture seule pour les clients (écriture via Edge Function de synchronisation)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.plan_limits(p_plan TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_norm TEXT := LOWER(TRIM(COALESCE(p_plan, 'free')));
BEGIN
  IF v_norm IN ('sta', 'standard', 'starter', 'artisan') THEN
    RETURN jsonb_build_object(
      'plan', 'sta',
      'max_references', 300,
      'max_depots', 3,
      'max_users', 99999,
      'default_modules', jsonb_build_array('stock')
    );
  ELSIF v_norm IN ('pro', 'professionnel', 'pme') THEN
    RETURN jsonb_build_object(
      'plan', 'pro',
      'max_references', 1000,
      'max_depots', 10,
      'max_users', 99999,
      'default_modules', jsonb_build_array('stock', 'outils', 'rapports')
    );
  ELSIF v_norm IN ('ent', 'entreprise', 'enterprise') THEN
    RETURN jsonb_build_object(
      'plan', 'ent',
      'max_references', 99999,
      'max_depots', 99999,
      'max_users', 99999,
      'default_modules', jsonb_build_array('stock', 'outils', 'formation', 'rapports')
    );
  ELSE
    RETURN jsonb_build_object(
      'plan', 'free',
      'max_references', 50,
      'max_depots', 1,
      'max_users', 99999,
      'default_modules', jsonb_build_array('stock')
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.plan_limits(TEXT) TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.${TABLES.licenseConfig} (
  id TEXT PRIMARY KEY DEFAULT 'active_license',
  license_key TEXT NOT NULL,
  plan_type TEXT NOT NULL DEFAULT 'free',
  modules TEXT[] NOT NULL DEFAULT ARRAY['stock']::TEXT[],
  max_depots INT NOT NULL DEFAULT 1,
  organization_name TEXT,
  signed_token TEXT,
  offline_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.${TABLES.licenseConfig}
  ADD COLUMN IF NOT EXISTS modules TEXT[] NOT NULL DEFAULT ARRAY['stock']::TEXT[];

ALTER TABLE public.${TABLES.licenseConfig} ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read license_config" ON public.${TABLES.licenseConfig};
CREATE POLICY "Allow read license_config" ON public.${TABLES.licenseConfig} 
  FOR SELECT TO authenticated, anon 
  USING (true);

INSERT INTO public.${TABLES.licenseConfig} (id, license_key, plan_type, modules, max_depots, organization_name)
VALUES ('active_license', 'TOT-STOCK-FREE', 'free', ARRAY['stock']::TEXT[], 1, 'Organisation Locale')
ON CONFLICT (id) DO NOTHING;
`;
}

