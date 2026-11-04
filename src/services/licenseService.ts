import { masterSupabase } from './masterSupabase';
import {
  LicenseInfo,
  LicenseVerificationResult,
  LicensePlan,
  CanonicalLicensePlan,
  LicenseModule,
  ALL_LICENSE_MODULES,
  plan_limits,
  normalizeToCanonicalPlan,
  getMaxDepotsForPlan,
} from '../types';
import { generateSecureRandomHex } from '../utils/crypto';
import {
  verifySignedLicenseToken,
  convertLegacyLicenseToken,
  extractProjectRef,
  syncLicenseTokenToClientDb,
} from './licenseTokenService';
import { updateCompanyLicenseInfoShared } from './clientSupabase';

export { plan_limits };

export const LICENSE_STORAGE_KEY = 'tot_inv_license_info';
export const LICENSE_CHECK_INTERVAL_DAYS = 15;
export const LICENSE_OFFLINE_GRACE_DAYS = 7;

/**
 * Normalizes modules list using plan_limits(plan).default_modules as fallback.
 */
export function normalizeLicenseModules(
  rawModules?: unknown,
  _wasLegacy = false,
  plan?: string
): LicenseModule[] {
  if (Array.isArray(rawModules) && rawModules.length > 0) {
    const valid = rawModules
      .map((m) => String(m).trim().toLowerCase() as LicenseModule)
      .filter((m): m is LicenseModule => ALL_LICENSE_MODULES.includes(m));
    if (valid.length > 0) {
      return Array.from(new Set(valid));
    }
  }
  return plan_limits(plan).default_modules;
}

/**
 * Attaches a non-enumerable getter for max_references computed strictly via plan_limits(plan)
 * and derives quotas strictly from signed_token when present so technical ceilings are NEVER
 * inflated or tampered with in localStorage.
 */
function withComputedPlanLimits(lic: LicenseInfo): LicenseInfo {
  let rawTokenObj: any = lic.signed_token;
  if (typeof rawTokenObj === 'string') {
    try {
      rawTokenObj = JSON.parse(rawTokenObj);
    } catch {
      rawTokenObj = undefined;
    }
  }
  const normalizedToken =
    rawTokenObj && typeof rawTokenObj === 'object'
      ? convertLegacyLicenseToken(rawTokenObj)
      : undefined;

  const hasSignedToken = Boolean(normalizedToken && normalizedToken.signature);
  const effectiveRawPlan = hasSignedToken
    ? String(normalizedToken!.plan || normalizedToken!.plan_type || 'free').trim().toLowerCase()
    : String(lic.plan || lic.plan_type || 'free').trim().toLowerCase();
  const effectiveKey = hasSignedToken
    ? normalizedToken!.license_key || lic.license_key
    : lic.license_key;

  const canonicalPlan = normalizeToCanonicalPlan(effectiveRawPlan, effectiveKey);
  const limits = plan_limits(canonicalPlan);
  const rawModulesSource = hasSignedToken ? normalizedToken!.modules : lic.modules;
  const modules = normalizeLicenseModules(rawModulesSource, false, canonicalPlan);

  const rawMaxDepots = hasSignedToken
    ? Number(normalizedToken!.max_depots)
    : Number(lic.max_depots);
  const maxDepots =
    rawMaxDepots > 0 ? Math.min(rawMaxDepots, limits.max_depots) : limits.max_depots;

  const clean: LicenseInfo = {
    ...lic,
    plan: canonicalPlan,
    plan_type: canonicalPlan,
    modules,
    max_depots: maxDepots,
    ...(normalizedToken ? { signed_token: normalizedToken } : {}),
  };

  // Ne jamais stocker max_references ni max_tools par client
  delete (clean as any).max_references;
  delete (clean as any).max_tools;

  Object.defineProperty(clean, 'max_references', {
    get() {
      const tokenPlan =
        this.signed_token && this.signed_token.signature
          ? this.signed_token.plan || this.signed_token.plan_type
          : this.plan || this.plan_type;
      return plan_limits(tokenPlan).max_references;
    },
    enumerable: false,
    configurable: true,
  });

  return clean;
}

/**
 * Calcule de manière synchrone les quotas effectifs strictement issus du jeton signé (`signed_token`).
 * Si une licence payante (`plan_type !== 'free'`) ne possède pas de `signed_token` signé,
 * les quotas appliqués retombent immédiatement sur ceux du forfait Gratuit (`plan_limits('free')`).
 */
export function enforceSignedLicenseQuotasSync(lic?: LicenseInfo | null): {
  plan: CanonicalLicensePlan;
  max_references: number;
  max_depots: number;
  modules: LicenseModule[];
  isSignedValidStructure: boolean;
} {
  const freeLimits = plan_limits('free');
  if (!lic) {
    return {
      plan: 'free',
      max_references: freeLimits.max_references,
      max_depots: freeLimits.max_depots,
      modules: freeLimits.default_modules,
      isSignedValidStructure: true,
    };
  }

  const claimedPlan = normalizeToCanonicalPlan(lic.plan || lic.plan_type || 'free', lic.license_key);
  const isFreeClaim =
    claimedPlan === 'free' ||
    !lic.license_key ||
    String(lic.license_key).trim().toUpperCase().startsWith('TOT-STOCK-FREE');

  let rawTokenObj: any = lic.signed_token;
  if (typeof rawTokenObj === 'string') {
    try {
      rawTokenObj = JSON.parse(rawTokenObj);
    } catch {
      rawTokenObj = undefined;
    }
  }
  const normalizedToken =
    rawTokenObj && typeof rawTokenObj === 'object'
      ? convertLegacyLicenseToken(rawTokenObj)
      : undefined;

  if (!normalizedToken || !normalizedToken.signature) {
    return {
      plan: 'free',
      max_references: freeLimits.max_references,
      max_depots: freeLimits.max_depots,
      modules: freeLimits.default_modules,
      isSignedValidStructure: isFreeClaim,
    };
  }

  const tokenPlan = normalizeToCanonicalPlan(
    normalizedToken.plan || normalizedToken.plan_type || 'free',
    normalizedToken.license_key
  );
  const tokenLimits = plan_limits(tokenPlan);
  const tokenModules = normalizeLicenseModules(normalizedToken.modules, false, tokenPlan);
  const rawTokenDepots = Number(normalizedToken.max_depots);
  const tokenMaxDepots =
    rawTokenDepots > 0 ? Math.min(rawTokenDepots, tokenLimits.max_depots) : tokenLimits.max_depots;

  return {
    plan: tokenPlan,
    max_references: tokenLimits.max_references,
    max_depots: tokenMaxDepots,
    modules: tokenModules,
    isSignedValidStructure: true,
  };
}

/**
 * Vérifie cryptographiquement la signature Ed25519 du `signed_token` de la licence
 * et garantit que tous les quotas appliqués proviennent exclusivement de la licence signée.
 * En cas d'absence de jeton signé ou de falsification sur une licence non gratuite,
 * rétrograde automatiquement vers la licence gratuite.
 */
export async function verifyAndApplySignedLicenseQuotas(
  lic?: LicenseInfo | null,
  expectedSupabaseUrl?: string
): Promise<{
  valid: boolean;
  license: LicenseInfo;
  quotas: {
    plan: CanonicalLicensePlan;
    max_references: number;
    max_depots: number;
    modules: LicenseModule[];
  };
  downgraded: boolean;
  reason?: string;
}> {
  const freeLimits = plan_limits('free');
  const freeQuotas = {
    plan: 'free' as CanonicalLicensePlan,
    max_references: freeLimits.max_references,
    max_depots: freeLimits.max_depots,
    modules: freeLimits.default_modules,
  };

  if (!lic) {
    const def = createDefaultFreeLicense();
    return { valid: true, license: def, quotas: freeQuotas, downgraded: false };
  }

  const claimedPlan = normalizeToCanonicalPlan(lic.plan || lic.plan_type || 'free', lic.license_key);
  const isFreeClaim =
    claimedPlan === 'free' ||
    !lic.license_key ||
    String(lic.license_key).trim().toUpperCase().startsWith('TOT-STOCK-FREE');

  if (isFreeClaim && !lic.signed_token) {
    const def = createDefaultFreeLicense(lic.organization_name || 'Organisation Locale');
    return { valid: true, license: def, quotas: freeQuotas, downgraded: false };
  }

  if (!lic.signed_token) {
    const downgradedLic = createDefaultFreeLicense(lic.organization_name || 'Organisation Locale');
    return {
      valid: false,
      license: downgradedLic,
      quotas: freeQuotas,
      downgraded: true,
      reason: 'Aucun jeton cryptographique signé (signed_token) présent pour cette licence.',
    };
  }

  const verification = await verifySignedLicenseToken(lic.signed_token, expectedSupabaseUrl);
  if (!verification.valid || !verification.token) {
    const downgradedLic = createDefaultFreeLicense(lic.organization_name || 'Organisation Locale');
    return {
      valid: false,
      license: downgradedLic,
      quotas: freeQuotas,
      downgraded: true,
      reason: verification.reason || 'Signature Ed25519 du jeton de licence invalide.',
    };
  }

  const verifiedToken = verification.token;
  const tokenPlan = normalizeToCanonicalPlan(verifiedToken.plan, verifiedToken.license_key);
  const tokenLimits = plan_limits(tokenPlan);
  const tokenModules = normalizeLicenseModules(verifiedToken.modules, false, tokenPlan);
  const tokenMaxDepots =
    Number(verifiedToken.max_depots) > 0
      ? Math.min(Number(verifiedToken.max_depots), tokenLimits.max_depots)
      : tokenLimits.max_depots;

  const certifiedLicense = withComputedPlanLimits({
    ...lic,
    license_key: verifiedToken.license_key || lic.license_key,
    organization_name: verifiedToken.organization_name || lic.organization_name,
    plan: tokenPlan,
    plan_type: tokenPlan,
    modules: tokenModules,
    max_depots: tokenMaxDepots,
    expires_at: verifiedToken.expires_at ?? lic.expires_at ?? null,
    offline_until: verifiedToken.offline_until || lic.offline_until,
    signed_token: verifiedToken,
    status: lic.is_active === false ? 'inactive' : 'valid',
  });

  return {
    valid: true,
    license: certifiedLicense,
    quotas: {
      plan: tokenPlan,
      max_references: tokenLimits.max_references,
      max_depots: tokenMaxDepots,
      modules: tokenModules,
    },
    downgraded: false,
  };
}

/**
 * Returns days remaining until next required 15-day server check.
 */
export function getDaysUntilNextCheck(license: LicenseInfo): number {
  if (!license.last_verified_at) return 0;
  const lastCheck = new Date(license.last_verified_at).getTime();
  const elapsedDays = (Date.now() - lastCheck) / (1000 * 60 * 60 * 24);
  const remaining = LICENSE_CHECK_INTERVAL_DAYS - elapsedDays;
  return Math.max(0, Math.round(remaining));
}

/**
 * Returns true if the lease has expired and a periodic check is due.
 */
export function isCheckDue(license: LicenseInfo): boolean {
  if (!license.last_verified_at) return true;
  const lastCheck = new Date(license.last_verified_at).getTime();
  const elapsedDays = (Date.now() - lastCheck) / (1000 * 60 * 60 * 24);

  const keySum = (license.license_key || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const jitterDays = keySum % 4;
  const effectiveInterval = Math.max(7, LICENSE_CHECK_INTERVAL_DAYS - jitterDays);

  return elapsedDays >= effectiveInterval;
}

/**
 * Generates an 8-character uppercase hex string using cryptographically secure RNG.
 */
export function generateHexSegment(length = 8): string {
  return generateSecureRandomHex(Math.ceil(length / 2)).substring(0, length);
}

export function generateClientKey(): string {
  return 'TOT-STOCK-FREE-COMMUNITY';
}

/**
 * Generates an initial default FREE license object for first-launch users.
 */
export function createDefaultFreeLicense(orgName = 'Organisation Locale'): LicenseInfo {
  const now = new Date();
  const expires = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const limits = plan_limits('free');

  return withComputedPlanLimits({
    license_key: 'TOT-STOCK-FREE-COMMUNITY',
    organization_name: orgName,
    plan: 'free',
    plan_type: 'free',
    modules: limits.default_modules,
    max_depots: limits.max_depots,
    is_active: true,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    last_verified_at: now.toISOString(),
    status: 'valid',
  });
}

/**
 * Loads current license from localStorage or initializes a default FREE license.
 * Normalizes any alias plan to canonical ('free' | 'sta' | 'pro' | 'ent').
 */
export function getSavedLicense(): LicenseInfo {
  try {
    const raw = localStorage.getItem(LICENSE_STORAGE_KEY);
    if (raw) {
      const parsed: LicenseInfo = JSON.parse(raw);
      if (parsed && parsed.license_key) {
        if (!parsed.status) {
          parsed.status = parsed.is_active === false ? 'inactive' : 'valid';
        }
        return withComputedPlanLimits(parsed);
      }
    }
  } catch (e) {
    console.warn('Error reading license from localStorage:', e);
  }

  const def = createDefaultFreeLicense();
  saveLicenseLocally(def);
  return def;
}

/**
 * Saves a license info object to localStorage without storing max_references or max_tools.
 */
export function saveLicenseLocally(license: LicenseInfo): void {
  try {
    const normalized = withComputedPlanLimits({
      ...license,
      status: license.status || (license.is_active === false ? 'inactive' : 'valid'),
    });
    const serializable: Record<string, any> = { ...normalized };
    delete serializable.max_references;
    delete serializable.max_tools;
    localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(serializable));
  } catch (e) {
    console.error('Error saving license to localStorage:', e);
  }
}

/**
 * Removes the saved license from localStorage (resets to default FREE).
 */
export function removeLicense(): void {
  try {
    localStorage.removeItem(LICENSE_STORAGE_KEY);
    const def = createDefaultFreeLicense();
    saveLicenseLocally(def);
  } catch (e) {
    console.error('Error resetting license:', e);
  }
}

/**
 * Returns allowed quota of references/articles for a given plan via plan_limits(plan).
 */
export function getPlanMaxReferences(plan?: LicensePlan | string): number {
  return plan_limits(plan).max_references;
}

/**
 * Normalizes plan code to canonical format ('free' | 'sta' | 'pro' | 'ent'),
 * converting read-only aliases ('artisan'/'starter'/'standard' -> 'sta', 'pme'/'professionnel' -> 'pro', 'enterprise'/'entreprise' -> 'ent').
 */
export function normalizePlanType(plan?: string, licenseKey?: string): CanonicalLicensePlan {
  return normalizeToCanonicalPlan(plan, licenseKey);
}

/**
 * Verifies a license key against the master server strictly via:
 * 1) Edge Function APP_TOT-Stock_licenses (action: 'validate' with license_key AND client_supabase_url)
 * 2) RPC verify_client_license(p_license_key, p_client_supabase_url)
 * Zero direct access to APP_TOT-Stock-licenses table.
 */
export async function verifyLicenseKey(
  key: string,
  clientSupabaseUrl?: string
): Promise<LicenseVerificationResult> {
  const cleanKey = (key || '').trim().toUpperCase();
  const current = getSavedLicense();
  const cleanUrl = (
    clientSupabaseUrl ||
    current.client_supabase_url ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem('tqt_company_url') : '') ||
    ''
  ).trim();

  if (!cleanKey) {
    return {
      success: false,
      message: 'Veuillez saisir une clé de licence valide (ex: TOT-STOCK-XXXXXXXX).',
    };
  }

  if (!cleanUrl) {
    return {
      success: false,
      message: 'L\'adresse du projet Supabase client est obligatoire pour vérifier ou lier une licence.',
    };
  }

  // 1. Validation et liaison contrôlée via l'Edge Function Maître (APP_TOT-Stock_licenses, action: 'validate')
  try {
    const { data: edgeData, error: edgeErr } = await masterSupabase.functions.invoke(
      'APP_TOT-Stock_licenses',
      {
        body: {
          action: 'validate',
          license_key: cleanKey,
          client_supabase_url: cleanUrl,
        },
      }
    );

    if (!edgeErr && edgeData) {
      if (edgeData.success === false) {
        return {
          success: false,
          message: edgeData.message || edgeData.error || 'Validation de licence refusée par le serveur maître.',
        };
      }

      if (edgeData.success && edgeData.license) {
        const licRow = edgeData.license;
        let signedToken = edgeData.signed_token
          ? convertLegacyLicenseToken(edgeData.signed_token)
          : undefined;

        if (edgeData.signed_token) {
          const tokenCheck = await verifySignedLicenseToken(edgeData.signed_token, cleanUrl);
          if (!tokenCheck.valid || !tokenCheck.token) {
            return {
              success: false,
              message:
                tokenCheck.reason ||
                'Jeton de licence signé invalide ou émis pour un autre projet Supabase.',
            };
          }
          signedToken = tokenCheck.token;
        }

        const canonicalPlan = signedToken
          ? normalizePlanType(signedToken.plan, signedToken.license_key || cleanKey)
          : normalizePlanType(licRow.plan || licRow.plan_type, licRow.license_key || cleanKey);
        const limits = plan_limits(canonicalPlan);
        const modules = normalizeLicenseModules(
          signedToken ? signedToken.modules : licRow.modules,
          false,
          canonicalPlan
        );
        const rawMaxDepots = signedToken
          ? Number(signedToken.max_depots)
          : Number(licRow.max_depots);
        const maxDepots =
          rawMaxDepots > 0 ? Math.min(rawMaxDepots, limits.max_depots) : limits.max_depots;

        const verifiedLicense = withComputedPlanLimits({
          id: licRow.id,
          license_key: signedToken?.license_key || licRow.license_key || cleanKey,
          organization_name:
            signedToken?.organization_name || licRow.organization_name || 'Entreprise Partenaire',
          client_supabase_url: licRow.client_supabase_url || cleanUrl,
          contact_email: licRow.contact_email,
          billing_cycle: licRow.billing_cycle,
          plan: canonicalPlan,
          plan_type: canonicalPlan,
          modules,
          max_depots: maxDepots,
          is_active: licRow.is_active !== false,
          expires_at: signedToken?.expires_at || licRow.expires_at || null,
          created_at: licRow.created_at,
          last_verified_at: new Date().toISOString(),
          signed_token: signedToken,
          offline_until: signedToken?.offline_until,
          status: 'valid',
        });

        saveLicenseLocally(verifiedLicense);

        return {
          success: true,
          license: verifiedLicense,
          message:
            edgeData.message ||
            `Licence ${canonicalPlan.toUpperCase()} certifiée par le serveur maître (modules : ${modules.join(', ')}, ${maxDepots} dépôts).`,
        };
      }
    }
  } catch (edgeException) {
    console.warn('Notice appel Edge Function validate:', edgeException);
  }

  // 2. Appel RPC verify_client_license exigeant OBLIGATOIREMENT la clé ET l'adresse du projet
  try {
    const { data: rpcData, error: rpcErr } = await masterSupabase.rpc('verify_client_license', {
      p_license_key: cleanKey,
      p_client_supabase_url: cleanUrl,
    });

    const rpcRow = !rpcErr && rpcData ? (Array.isArray(rpcData) ? rpcData[0] : rpcData) : null;

    if (rpcRow && rpcRow.license_key) {
      if (rpcRow.is_active === false) {
        return {
          success: false,
          message: 'Cette licence a été révoquée par l\'administrateur éditeur sur le serveur maître.',
        };
      }
      if (rpcRow.expires_at && new Date(rpcRow.expires_at).getTime() < Date.now()) {
        return {
          success: false,
          message: `Cette licence a expiré sur le serveur maître le ${new Date(rpcRow.expires_at).toLocaleDateString('fr-FR')}.`,
        };
      }

      const rawPlan = String(rpcRow.plan_type || 'free').toLowerCase();
      const canonicalPlan = normalizePlanType(rawPlan, rpcRow.license_key || cleanKey);
      const limits = plan_limits(canonicalPlan);
      const modules = normalizeLicenseModules(rpcRow.modules, false, canonicalPlan);
      const maxDepots = Math.min(Math.max(Number(rpcRow.max_depots) || 0, 1), limits.max_depots);

      let preservedSignedToken =
        current.signed_token &&
        String(current.license_key || '').trim().toUpperCase() === cleanKey
          ? convertLegacyLicenseToken(current.signed_token)
          : undefined;

      if (preservedSignedToken) {
        const tokenCheck = await verifySignedLicenseToken(preservedSignedToken, cleanUrl);
        if (!tokenCheck.valid || !tokenCheck.token) {
          preservedSignedToken = undefined;
        } else {
          preservedSignedToken = tokenCheck.token;
        }
      }

      const verifiedLicense = withComputedPlanLimits({
        id: rpcRow.id,
        license_key: rpcRow.license_key,
        organization_name: rpcRow.organization_name || 'Entreprise Partenaire',
        client_supabase_url: rpcRow.client_supabase_url || cleanUrl,
        contact_email: rpcRow.contact_email,
        billing_cycle: rpcRow.billing_cycle,
        plan: canonicalPlan,
        plan_type: canonicalPlan,
        modules,
        max_depots: maxDepots,
        is_active: rpcRow.is_active !== false,
        expires_at: rpcRow.expires_at || null,
        created_at: rpcRow.created_at,
        last_verified_at: new Date().toISOString(),
        status: 'valid',
        ...(preservedSignedToken
          ? {
              signed_token: preservedSignedToken,
              offline_until: preservedSignedToken.offline_until,
            }
          : {}),
      });

      saveLicenseLocally(verifiedLicense);

      return {
        success: true,
        license: verifiedLicense,
        message: `Licence ${canonicalPlan.toUpperCase()} certifiée par le serveur maître (modules : ${modules.join(', ')}, ${maxDepots} dépôts).`,
      };
    }
  } catch (rpcErr) {
    console.warn('Erreur appel RPC verify_client_license:', rpcErr);
  }

  // 3. Fallback hors-ligne : vérification cryptographique du jeton signé en cache (avec contrôle de kid et retrait de clé)
  if (current.license_key && current.license_key.toUpperCase() === cleanKey) {
    if (current.signed_token) {
      const verification = await verifySignedLicenseToken(current.signed_token, cleanUrl);
      if (verification.valid && verification.token) {
        const updatedOffline = withComputedPlanLimits({
          ...current,
          plan: verification.token.plan,
          plan_type: verification.token.plan,
          modules: verification.token.modules,
          max_depots: verification.token.max_depots,
          signed_token: verification.token,
        });
        saveLicenseLocally(updatedOffline);
        return {
          success: true,
          license: updatedOffline,
          message: `Mode hors-ligne : Licence active validée via jeton signé (+7 jours jusqu'au ${new Date(verification.token.offline_until).toLocaleDateString('fr-FR')}).`,
        };
      } else {
        return {
          success: false,
          license: current,
          message: `Jeton hors-ligne expiré ou invalide : ${verification.reason || 'Connexion au serveur éditeur requise.'}`,
        };
      }
    }
    if (current.plan_type === 'free') {
      return {
        success: true,
        license: current,
        message: 'Plan Gratuit communautaire actif.',
      };
    }
  }

  return {
    success: false,
    message: `Validation refusée pour "${cleanKey}" sur le projet "${cleanUrl}". Vérifiez que la clé est exacte et que la liaison au projet a été autorisée par l'éditeur.`,
  };
}

/**
 * Updates organization metadata and recovers license strictly using both license_key and clientSupabaseUrl
 * via Edge Function APP_TOT-Stock_licenses (never via direct table access).
 */
export async function provisionServerLicense(
  orgName: string,
  clientSupabaseUrl?: string,
  _planType: string = 'free',
  contactEmail?: string,
  _billingCycle?: 'annual' | 'monthly'
): Promise<LicenseVerificationResult> {
  const current = getSavedLicense();
  const cleanOrg = (orgName || '').trim() || 'Organisation Locale';
  const cleanUrl = (clientSupabaseUrl || current.client_supabase_url || '').trim() || undefined;
  const cleanEmail = (contactEmail || current.contact_email || '').trim() || undefined;

  if (
    current.license_key &&
    current.license_key !== 'TOT-STOCK-FREE-COMMUNITY' &&
    current.license_key !== 'TOT-STOCK-FREE-INIT' &&
    cleanUrl
  ) {
    try {
      if (cleanEmail) {
        await masterSupabase.functions.invoke('APP_TOT-Stock_licenses', {
          body: {
            action: 'update_contact',
            license_key: current.license_key,
            organization_name: cleanOrg,
            contact_email: cleanEmail,
            client_supabase_url: cleanUrl,
          },
        });
      }
      const verRes = await verifyLicenseKey(current.license_key, cleanUrl);
      if (verRes.success && verRes.license) {
        return verRes;
      }
    } catch {}
  }

  const updatedLocal = withComputedPlanLimits({
    ...current,
    organization_name: cleanOrg,
    client_supabase_url: cleanUrl || current.client_supabase_url,
    contact_email: cleanEmail || current.contact_email,
  });
  saveLicenseLocally(updatedLocal);
  return {
    success: true,
    license: updatedLocal,
    message: `Organisation "${cleanOrg}" mise à jour.`,
  };
}

/**
 * Updates the contact/billing email on the license strictly via the Master Edge Function,
 * requiring the license key. Never accesses APP_TOT-Stock-licenses directly.
 */
export async function associateContactEmailWithLicense(
  email: string,
  explicitLicenseKey?: string
): Promise<{ success: boolean; message: string }> {
  const current = getSavedLicense();
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanKey = (explicitLicenseKey || current.license_key || '').trim().toUpperCase();

  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { success: false, message: 'Veuillez saisir une adresse email valide.' };
  }

  if (!cleanKey || cleanKey === 'TOT-STOCK-FREE-COMMUNITY' || cleanKey.startsWith('TOT-STOCK-FREE')) {
    return {
      success: false,
      message: 'Une clé de licence officielle est exigée pour mettre à jour l\'adresse e-mail de contact sur le serveur maître.',
    };
  }

  try {
    const { data, error } = await masterSupabase.functions.invoke('APP_TOT-Stock_licenses', {
      body: {
        action: 'update_contact',
        license_key: cleanKey,
        contact_email: cleanEmail,
        client_supabase_url: current.client_supabase_url,
      },
    });

    if (error || data?.success === false) {
      return {
        success: false,
        message: data?.error || data?.message || error?.message || 'Mise à jour de l\'e-mail refusée par le serveur maître.',
      };
    }

    const updated = withComputedPlanLimits({
      ...current,
      contact_email: cleanEmail,
    });
    saveLicenseLocally(updated);

    return {
      success: true,
      message: data?.message || `Email "${cleanEmail}" associé avec succès à la licence ${cleanKey}.`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Erreur communication avec l'Edge Function : ${err?.message || 'Inconnue'}`,
    };
  }
}

export interface LicenseSyncResult {
  updated: boolean;
  planChanged: boolean;
  license: LicenseInfo;
  message: string;
  rlsBlocked?: boolean;
  serverFound?: boolean;
}

export const DISCOVER_COOLDOWN_KEY = 'tot_license_discover_ts';
export const DISCOVER_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

export type LicenseDiscoveryStatus =
  | 'found'
  | 'not_found'
  | 'inactive'
  | 'expired'
  | 'invalid_token'
  | 'cooldown'
  | 'denied'
  | 'network_error';

export interface LicenseDiscoveryResult {
  success: boolean;
  status: LicenseDiscoveryStatus;
  license?: LicenseInfo;
  message: string;
}

export interface DiscoverLicenseOptions {
  force?: boolean;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  invokeFn?: (
    fnName: string,
    args: { body: Record<string, any> }
  ) => Promise<{ data: any; error: any }>;
  verifyTokenFn?: typeof verifySignedLicenseToken;
}

/**
 * Découvre automatiquement la licence liée à `clientUrl` auprès de la base maître
 * en prouvant l'appartenance au projet (`clientUrl`, `anonKey`, `accessToken`).
 * Vérifie obligatoirement le `signed_token` reçu avec `verifySignedLicenseToken`
 * avant d'accepter et d'enregistrer la licence.
 */
export async function discoverLicenseByProjectUrl(
  clientUrl: string,
  anonKey: string,
  accessToken: string,
  options?: DiscoverLicenseOptions
): Promise<LicenseDiscoveryResult> {
  const cleanUrl = (clientUrl || '').trim();
  const cleanAnonKey = (anonKey || '').trim();
  const cleanAccessToken = (accessToken || '').trim();
  const storage = options?.storage || (typeof localStorage !== 'undefined' ? localStorage : undefined);
  const force = options?.force === true;

  if (!cleanUrl || !cleanAnonKey || !cleanAccessToken) {
    return {
      success: false,
      status: 'denied',
      message: 'Adresse du projet, clé publique et session utilisateur active requises pour rechercher la licence.',
    };
  }

  // Vérification du délai de 24 h après une réponse "aucune licence" (sauf appel manuel forcé)
  if (!force && storage) {
    try {
      const lastTsRaw = storage.getItem(DISCOVER_COOLDOWN_KEY);
      if (lastTsRaw) {
        const lastTs = Number(lastTsRaw);
        if (Number.isFinite(lastTs) && Date.now() - lastTs < DISCOVER_COOLDOWN_MS) {
          return {
            success: false,
            status: 'cooldown',
            message: 'Recherche automatique déjà effectuée au cours des dernières 24 heures.',
          };
        }
      }
    } catch {
      // ignore storage read errors
    }
  }

  const invoke =
    options?.invokeFn ||
    ((fnName: string, args: { body: Record<string, any> }) =>
      masterSupabase.functions.invoke(fnName, args));
  const verifyToken = options?.verifyTokenFn || verifySignedLicenseToken;

  try {
    let { data, error } = await invoke('APP_TOT-Stock_licenses', {
      body: {
        action: 'discover',
        client_supabase_url: cleanUrl,
        client_anon_key: cleanAnonKey,
        client_access_token: cleanAccessToken,
      },
    });

    // When @supabase/functions-js receives a non-2xx HTTP status, data is null and error.context holds the Response
    if (!data && error && typeof (error as any)?.context?.json === 'function') {
      try {
        const cloned =
          typeof (error as any).context.clone === 'function'
            ? (error as any).context.clone()
            : (error as any).context;
        data = await cloned.json();
      } catch {
        // ignore JSON parse errors
      }
    }

    const errStatus = (error as any)?.context?.status || (error as any)?.status;
    const code = String(data?.code || '').toUpperCase();
    const rawMsg = String(data?.message || data?.error || error?.message || '');

    const isEdgeFunctionNotDeployed =
      code === 'NOT_FOUND' ||
      rawMsg.includes('Requested function was not found') ||
      (error as any)?.name === 'FunctionsFetchError';

    if (
      !isEdgeFunctionNotDeployed &&
      (code === 'LICENSE_NOT_FOUND' ||
        errStatus === 404 ||
        rawMsg.toLowerCase().includes('aucune licence'))
    ) {
      if (storage) {
        try {
          storage.setItem(DISCOVER_COOLDOWN_KEY, String(Date.now()));
        } catch {
          // ignore storage write errors
        }
      }
      return {
        success: false,
        status: 'not_found',
        message: data?.message || 'Aucune licence liée à ce projet sur le serveur maître.',
      };
    }

    if (
      code === 'LICENSE_INACTIVE' ||
      rawMsg.toLowerCase().includes('inactive') ||
      rawMsg.toLowerCase().includes('révoquée')
    ) {
      return {
        success: false,
        status: 'inactive',
        message: data?.message || 'La licence associée à ce projet est inactive ou révoquée.',
      };
    }

    if (
      code === 'LICENSE_EXPIRED' ||
      rawMsg.toLowerCase().includes('expiré')
    ) {
      return {
        success: false,
        status: 'expired',
        message: data?.message || 'La licence associée à ce projet a expiré.',
      };
    }

    if (error || !data || data.success === false || !data.license) {
      if (
        code === 'DISCOVER_DENIED' ||
        errStatus === 401 ||
        errStatus === 403
      ) {
        return {
          success: false,
          status: 'denied',
          message: data?.message || 'Vérification du projet refusée par le serveur maître.',
        };
      }
      return {
        success: false,
        status: 'network_error',
        message: isEdgeFunctionNotDeployed
          ? 'La fonction Edge APP_TOT-Stock_licenses n\'est pas encore déployée sur la base maître Éditeur.'
          : rawMsg || 'Impossible de joindre le serveur maître pour rechercher la licence.',
      };
    }

    // Vérification obligatoire du signed_token avec verifySignedLicenseToken avant d'accepter la licence
    if (!data.signed_token) {
      return {
        success: false,
        status: 'invalid_token',
        message: 'Réponse du serveur maître rejetée : jeton signé manquant.',
      };
    }

    const tokenVerification = await verifyToken(data.signed_token, cleanUrl);
    if (!tokenVerification.valid || !tokenVerification.token) {
      return {
        success: false,
        status: 'invalid_token',
        message: `Jeton de licence refusé : ${tokenVerification.reason || 'Signature ou projet invalide.'}`,
      };
    }

    const srv = data.license;
    const verifiedToken = tokenVerification.token;
    const planType = verifiedToken.plan;
    const modules = verifiedToken.modules;
    const limits = plan_limits(planType);
    const maxDepots = verifiedToken.max_depots || Number(srv.max_depots) || limits.max_depots;

    const discoveredLicense = withComputedPlanLimits({
      id: srv.id,
      license_key: verifiedToken.license_key || srv.license_key,
      organization_name:
        verifiedToken.organization_name || srv.organization_name || 'Entreprise Partenaire',
      client_supabase_url: cleanUrl,
      contact_email: srv.contact_email || undefined,
      billing_cycle: srv.billing_cycle || 'annual',
      plan: planType,
      plan_type: planType,
      modules,
      max_depots: maxDepots,
      is_active: srv.is_active !== false,
      created_at: srv.created_at || new Date().toISOString(),
      expires_at: verifiedToken.expires_at || srv.expires_at || null,
      last_verified_at: new Date().toISOString(),
      status: 'valid',
      signed_token: verifiedToken,
      offline_until: verifiedToken.offline_until,
    });

    if (storage) {
      try {
        storage.removeItem(DISCOVER_COOLDOWN_KEY);
      } catch {
        // ignore
      }
    }

    saveLicenseLocally(discoveredLicense);

    return {
      success: true,
      status: 'found',
      license: discoveredLicense,
      message:
        data.message ||
        `Licence ${planType.toUpperCase()} (${discoveredLicense.license_key}) retrouvée et activée automatiquement.`,
    };
  } catch (err: any) {
    return {
      success: false,
      status: 'network_error',
      message: `Erreur réseau lors de la recherche automatique de licence : ${err?.message || 'Inconnue'}`,
    };
  }
}

/**
 * Vérifie si l'utilisateur connecté possède la permission `perm_config_license`
 * ou un rôle administrateur (0 ou 1) l'autorisant à déclencher la découverte de licence.
 */
async function canCurrentUserDiscoverLicense(client: any, authUser?: any): Promise<boolean> {
  try {
    if (typeof localStorage !== 'undefined') {
      const savedUserRaw = localStorage.getItem('tot_inv_current_user');
      if (savedUserRaw) {
        const savedUser = JSON.parse(savedUserRaw);
        const roleId = Number(savedUser?.role_id);
        if (roleId === 0 || roleId === 1) {
          return true;
        }
        const savedRolesRaw = localStorage.getItem('tot_inv_roles');
        if (savedRolesRaw) {
          const savedRoles = JSON.parse(savedRolesRaw);
          if (Array.isArray(savedRoles)) {
            const matchingRole = savedRoles.find((r: any) => Number(r?.id) === roleId);
            if (matchingRole && Array.isArray(matchingRole.permissions)) {
              return matchingRole.permissions.includes('perm_config_license');
            }
          }
        }
        if (Number.isFinite(roleId) && roleId > 1) {
          return false;
        }
      }
    }
  } catch {
    // fallback to DB query if localStorage parsing fails
  }

  if (!client || !authUser?.id) return false;

  try {
    const { data: userRow } = await client
      .from('users')
      .select('role_id')
      .eq('auth_user_id', authUser.id)
      .maybeSingle();

    if (!userRow && authUser.email) {
      const { data: emailRow } = await client
        .from('users')
        .select('role_id')
        .ilike('email', authUser.email)
        .maybeSingle();
      if (emailRow) {
        const rId = Number(emailRow.role_id);
        if (rId === 0 || rId === 1) return true;
        const { data: roleRow } = await client
          .from('roles')
          .select('permissions')
          .eq('id', rId)
          .maybeSingle();
        return Array.isArray(roleRow?.permissions) && roleRow.permissions.includes('perm_config_license');
      }
      return false;
    }

    if (userRow) {
      const rId = Number(userRow.role_id);
      if (rId === 0 || rId === 1) return true;
      const { data: roleRow } = await client
        .from('roles')
        .select('permissions')
        .eq('id', rId)
        .maybeSingle();
      return Array.isArray(roleRow?.permissions) && roleRow.permissions.includes('perm_config_license');
    }
  } catch {
    // ignore DB errors
  }

  return false;
}

/**
 * Recovers the company license from the client DB and master server.
 * Jamais par URL seule : l'URL doit être accompagnée de la preuve de session sur ce projet.
 * Never searches by email, never lists rows from the master table.
 */
export async function recoverCompanyLicenseFromServerAndClientDb(
  clientSupabaseUrl?: string,
  client?: any,
  currentLicense?: LicenseInfo,
  forceDiscover = false,
  discoverOptions?: DiscoverLicenseOptions
): Promise<LicenseInfo | null> {
  const cleanUrl = (clientSupabaseUrl || currentLicense?.client_supabase_url || '').trim();
  if (!cleanUrl) return null;

  const verifyToken = discoverOptions?.verifyTokenFn || verifySignedLicenseToken;
  let offlineFallbackLicense: LicenseInfo | null = null;

  if (client) {
    // 1. Check app_settings on client DB for stored license_key
    try {
      const { data: settingsRows } = await client
        .from('app_settings')
        .select('key, value')
        .in('key', ['company_license_info', 'license_key', 'company_name']);

      if (Array.isArray(settingsRows) && settingsRows.length > 0) {
        const infoRow = settingsRows.find((r: any) => r.key === 'company_license_info');
        const keyRow = settingsRows.find((r: any) => r.key === 'license_key');
        const nameRow = settingsRows.find((r: any) => r.key === 'company_name');

        let parsedInfo: Record<string, any> | null = null;
        if (infoRow?.value) {
          try {
            parsedInfo = JSON.parse(infoRow.value);
          } catch {}
        }

        const candidateKey = (keyRow?.value || parsedInfo?.license_key || '').trim().toUpperCase();
        if (candidateKey && !candidateKey.startsWith('TOT-STOCK-FREE')) {
          const verRes = await verifyLicenseKey(candidateKey, cleanUrl);
          if (verRes.success && verRes.license) {
            let finalLic = verRes.license;
            if (!finalLic.signed_token && parsedInfo?.signed_token) {
              const tokenCheck = await verifyToken(parsedInfo.signed_token, cleanUrl);
              if (tokenCheck.valid && tokenCheck.token) {
                finalLic = withComputedPlanLimits({
                  ...finalLic,
                  signed_token: tokenCheck.token,
                  offline_until: tokenCheck.token.offline_until,
                });
              }
            }
            if (
              (!finalLic.organization_name || finalLic.organization_name === 'Entreprise Partenaire') &&
              (parsedInfo?.organization_name || nameRow?.value)
            ) {
              finalLic = withComputedPlanLimits({
                ...finalLic,
                organization_name: parsedInfo?.organization_name || nameRow?.value,
              });
            }
            saveLicenseLocally(finalLic);
            return finalLic;
          }

          if (parsedInfo?.signed_token) {
            const tokenCheck = await verifyToken(parsedInfo.signed_token, cleanUrl);
            if (tokenCheck.valid && tokenCheck.token) {
              offlineFallbackLicense = withComputedPlanLimits({
                id: parsedInfo.id,
                license_key: candidateKey,
                organization_name: parsedInfo.organization_name || nameRow?.value || 'Entreprise Partenaire',
                client_supabase_url: cleanUrl,
                contact_email: parsedInfo.contact_email,
                billing_cycle: parsedInfo.billing_cycle,
                plan: tokenCheck.token.plan,
                plan_type: tokenCheck.token.plan,
                modules: tokenCheck.token.modules,
                max_depots: tokenCheck.token.max_depots,
                is_active: parsedInfo.is_active !== false,
                created_at: parsedInfo.created_at || new Date().toISOString(),
                expires_at: tokenCheck.token.expires_at || null,
                last_verified_at: new Date().toISOString(),
                status: 'valid',
                signed_token: tokenCheck.token,
                offline_until: tokenCheck.token.offline_until,
              });
            }
          }
        }
      }
    } catch {}

    // 2. Check license_config on client DB for stored license_key
    try {
      const { data: cfgRows } = await client
        .from('license_config')
        .select('*')
        .limit(5);

      const cfgRow =
        Array.isArray(cfgRows) && cfgRows.length > 0
          ? cfgRows.find((r: any) => String(r.id) === 'active_license' || Number(r.id) === 1) || cfgRows[0]
          : null;

      if (cfgRow && cfgRow.license_key) {
        const cfgKey = String(cfgRow.license_key).trim().toUpperCase();
        if (cfgKey && !cfgKey.startsWith('TOT-STOCK-FREE')) {
          const verRes = await verifyLicenseKey(cfgKey, cleanUrl);
          if (verRes.success && verRes.license) {
            let finalLic = verRes.license;
            if (!finalLic.signed_token && cfgRow.signed_token) {
              const tokenCheck = await verifyToken(cfgRow.signed_token, cleanUrl);
              if (tokenCheck.valid && tokenCheck.token) {
                finalLic = withComputedPlanLimits({
                  ...finalLic,
                  signed_token: tokenCheck.token,
                  offline_until: tokenCheck.token.offline_until,
                });
              }
            }
            if (
              (!finalLic.organization_name || finalLic.organization_name === 'Entreprise Partenaire') &&
              cfgRow.organization_name
            ) {
              finalLic = withComputedPlanLimits({
                ...finalLic,
                organization_name: cfgRow.organization_name,
              });
            }
            saveLicenseLocally(finalLic);
            syncLicenseToClientDatabase(finalLic, client).catch(() => {});
            return finalLic;
          }

          if (cfgRow.signed_token && !offlineFallbackLicense) {
            const tokenCheck = await verifyToken(cfgRow.signed_token, cleanUrl);
            if (tokenCheck.valid && tokenCheck.token) {
              offlineFallbackLicense = withComputedPlanLimits({
                id: cfgRow.id,
                license_key: cfgKey,
                organization_name: cfgRow.organization_name || 'Entreprise Partenaire',
                client_supabase_url: cleanUrl,
                plan: tokenCheck.token.plan,
                plan_type: tokenCheck.token.plan,
                modules: tokenCheck.token.modules,
                max_depots: tokenCheck.token.max_depots,
                is_active: true,
                created_at: cfgRow.updated_at || new Date().toISOString(),
                expires_at: tokenCheck.token.expires_at || null,
                last_verified_at: new Date().toISOString(),
                status: 'valid',
                signed_token: tokenCheck.token,
                offline_until: tokenCheck.token.offline_until,
              });
            }
          }
        }
      }
    } catch {}
  }

  // 3. If currentLicense has a non-free key and we have cleanUrl, verify with both key AND project URL
  if (
    currentLicense?.license_key &&
    !currentLicense.license_key.startsWith('TOT-STOCK-FREE') &&
    cleanUrl
  ) {
    const verRes = await verifyLicenseKey(currentLicense.license_key, cleanUrl);
    if (verRes.success && verRes.license) {
      return verRes.license;
    }
  }

  if (offlineFallbackLicense) {
    saveLicenseLocally(offlineFallbackLicense);
    return offlineFallbackLicense;
  }

  // 4. Découverte automatique par URL + preuve de session sur le projet client
  // Uniquement si les étapes 1 à 3 n'ont trouvé aucune licence payante valide,
  // qu'une session utilisateur active existe (jeton de session requis, jamais d'appel sans session),
  // que l'utilisateur a perm_config_license (ou rôle 0/1),
  // et dans la limite d'un essai automatique par 24 h si aucune licence n'est trouvée.
  if (client && typeof client.auth?.getSession === 'function') {
    try {
      const { data: sessionData } = await client.auth.getSession();
      const session = sessionData?.session;
      const anonKey =
        (typeof localStorage !== 'undefined' ? localStorage.getItem('tqt_company_key') : '') ||
        (client as any)?.supabaseKey ||
        '';
      const accessToken = session?.access_token || '';
      if (session && accessToken && anonKey) {
        const hasPermission = await canCurrentUserDiscoverLicense(client, session.user);
        if (hasPermission) {
          const discoverRes = await discoverLicenseByProjectUrl(cleanUrl, anonKey, accessToken, {
            ...discoverOptions,
            force: forceDiscover || discoverOptions?.force === true,
          });
          if (discoverRes.success && discoverRes.license) {
            saveLicenseLocally(discoverRes.license);
            await syncLicenseToClientDatabase(discoverRes.license, client).catch(() => {});
            return discoverRes.license;
          }
        }
      }
    } catch {
      // ignore automatic discovery errors
    }
  }

  return null;
}

/**
 * 15-Day Periodic & On-Demand License Verification and Sync.
 * Uses strictly verify_client_license(p_license_key, p_client_supabase_url) and the validate Edge Function.
 */
export async function checkAndSync15DaysLicense(
  currentLicense: LicenseInfo,
  clientSupabaseUrl?: string,
  forceCheck = false,
  client?: any
): Promise<LicenseSyncResult> {
  const cleanKey = (currentLicense.license_key || '').trim().toUpperCase();
  const cleanUrl = (clientSupabaseUrl || currentLicense.client_supabase_url || '').trim() || undefined;
  const isDefaultFreeKey =
    !cleanKey ||
    cleanKey === 'TOT-STOCK-FREE-COMMUNITY' ||
    cleanKey.startsWith('TOT-STOCK-FREE') ||
    currentLicense.plan_type === 'free';

  if (isDefaultFreeKey || forceCheck || (cleanUrl && currentLicense.client_supabase_url !== cleanUrl)) {
    const recovered = await recoverCompanyLicenseFromServerAndClientDb(
      cleanUrl,
      client,
      currentLicense,
      forceCheck
    );
    if (
      recovered &&
      (recovered.license_key !== currentLicense.license_key ||
        recovered.plan_type !== currentLicense.plan_type ||
        recovered.max_depots !== currentLicense.max_depots)
    ) {
      const planChanged =
        recovered.plan_type !== currentLicense.plan_type ||
        recovered.license_key !== currentLicense.license_key;
      return {
        updated: true,
        planChanged,
        serverFound: true,
        license: recovered,
        message: `Licence entreprise ${recovered.plan_type.toUpperCase()} (${recovered.license_key}) vérifiée et synchronisée.`,
      };
    }
  }

  if (!forceCheck && !isDefaultFreeKey) {
    const isOverdue = isCheckDue(currentLicense);
    if (!isOverdue && currentLicense.status === 'valid') {
      return {
        updated: false,
        planChanged: false,
        license: withComputedPlanLimits(currentLicense),
        message: 'Bail de licence valide (cache local certifié, 0 requête réseau requise).',
      };
    }
  }

  if (isDefaultFreeKey) {
    const updated = withComputedPlanLimits({
      ...currentLicense,
      last_verified_at: new Date().toISOString(),
      status: 'valid',
    });
    saveLicenseLocally(updated);
    return {
      updated: false,
      planChanged: false,
      serverFound: true,
      license: updated,
      message: 'Plan Gratuit communautaire actif.',
    };
  }

  if (!cleanUrl) {
    return {
      updated: false,
      planChanged: false,
      serverFound: false,
      license: withComputedPlanLimits(currentLicense),
      message: 'Adresse du projet Supabase client requise pour vérifier la licence auprès du serveur maître.',
    };
  }

  // Vérification via RPC verify_client_license(p_license_key, p_client_supabase_url) avec clé ET adresse du projet
  try {
    const { data: rpcData, error: rpcErr } = await masterSupabase.rpc('verify_client_license', {
      p_license_key: cleanKey,
      p_client_supabase_url: cleanUrl,
    });

    const serverRow = !rpcErr && rpcData ? (Array.isArray(rpcData) ? rpcData[0] : rpcData) : null;

    if (serverRow && serverRow.license_key) {
      if (serverRow.is_active === false) {
        const updated = withComputedPlanLimits({
          ...currentLicense,
          is_active: false,
          status: 'inactive',
          last_verified_at: new Date().toISOString(),
        });
        saveLicenseLocally(updated);
        return {
          updated: true,
          planChanged: true,
          serverFound: true,
          license: updated,
          message: 'Cette licence a été révoquée par l\'administrateur éditeur sur le serveur maître.',
        };
      }

      if (serverRow.expires_at && new Date(serverRow.expires_at).getTime() < Date.now()) {
        const updated = withComputedPlanLimits({
          ...currentLicense,
          is_active: false,
          status: 'expired',
          last_verified_at: new Date().toISOString(),
        });
        saveLicenseLocally(updated);
        return {
          updated: true,
          planChanged: true,
          serverFound: true,
          license: updated,
          message: `Cette licence a expiré sur le serveur maître le ${new Date(serverRow.expires_at).toLocaleDateString('fr-FR')}.`,
        };
      }

      const rawPlan = String(serverRow.plan_type || 'free').toLowerCase();
      const serverPlan = normalizePlanType(rawPlan, serverRow.license_key);
      const limits = plan_limits(serverPlan);
      const serverModules = normalizeLicenseModules(serverRow.modules, false, serverPlan);
      const serverDepots = Math.max(Number(serverRow.max_depots) || 0, limits.max_depots);
      const serverActive = serverRow.is_active !== false;

      const planChanged =
        serverPlan !== normalizePlanType(currentLicense.plan_type, currentLicense.license_key) ||
        serverDepots !== currentLicense.max_depots ||
        serverActive !== currentLicense.is_active;

      const updated = withComputedPlanLimits({
        ...currentLicense,
        id: serverRow.id || currentLicense.id,
        license_key: serverRow.license_key || currentLicense.license_key,
        organization_name: serverRow.organization_name || currentLicense.organization_name,
        client_supabase_url: serverRow.client_supabase_url || cleanUrl,
        contact_email: serverRow.contact_email || currentLicense.contact_email,
        billing_cycle: serverRow.billing_cycle || currentLicense.billing_cycle,
        plan: serverPlan,
        plan_type: serverPlan,
        modules: serverModules,
        max_depots: serverDepots,
        is_active: serverActive,
        expires_at: serverRow.expires_at || null,
        last_verified_at: new Date().toISOString(),
        status: serverActive ? 'valid' : 'inactive',
      });

      saveLicenseLocally(updated);

      return {
        updated: true,
        planChanged,
        serverFound: true,
        license: updated,
        message: planChanged
          ? `Changement serveur détecté : Votre formule est désormais ${serverPlan.toUpperCase()} (modules : ${serverModules.join(', ')}, ${serverDepots} dépôts).`
          : 'Licence certifiée avec succès auprès du serveur maître (prochain contrôle dans 15 jours).',
      };
    }

    return {
      updated: false,
      planChanged: false,
      serverFound: false,
      license: withComputedPlanLimits(currentLicense),
      message: `Clé "${cleanKey}" non liée ou introuvable pour le projet "${cleanUrl}" sur le serveur maître.`,
    };
  } catch (err: any) {
    console.warn('Erreur vérification base maître:', err);
  }

  return {
    updated: false,
    planChanged: false,
    serverFound: false,
    license: withComputedPlanLimits(currentLicense),
    message: 'Serveur maître momentanément indisponible (erreur réseau). Utilisation du cache de licence local.',
  };
}

/**
 * Upgrades an existing license on the master server via Edge Function.
 */
export async function upgradeServerLicense(
  targetPlan: LicensePlan,
  billingCycle: 'annual' | 'monthly' = 'annual',
  contactEmail?: string,
  organizationName?: string,
  clientSupabaseUrl?: string
): Promise<LicenseVerificationResult> {
  const current = getSavedLicense();
  const cleanOrg = (organizationName || current.organization_name || 'Client').trim();
  const cleanUrl = (clientSupabaseUrl || current.client_supabase_url || '').trim() || undefined;
  const cleanEmail = (contactEmail || current.contact_email || '').trim() || undefined;
  const canonicalTarget = normalizePlanType(targetPlan);

  try {
    const { data, error } = await masterSupabase.functions.invoke('APP_TOT-Stock_licenses', {
      body: {
        action: 'upgrade',
        license_key: current.license_key,
        plan: canonicalTarget,
        plan_type: canonicalTarget,
        billing_cycle: billingCycle,
        organization_name: cleanOrg,
        client_supabase_url: cleanUrl,
        contact_email: cleanEmail,
      },
    });

    if (error) {
      return {
        success: false,
        message: error.message || 'Erreur lors de la mise à niveau.',
      };
    }

    if (data?.success && data?.license) {
      const uPlan = normalizePlanType(data.license.plan || data.license.plan_type || canonicalTarget, data.license.license_key);
      const uModules = normalizeLicenseModules(data.license.modules, false, uPlan);
      const signedToken = data.signed_token ? convertLegacyLicenseToken(data.signed_token) : undefined;
      const updated = withComputedPlanLimits({
        license_key: data.license.license_key || current.license_key,
        plan: uPlan,
        plan_type: uPlan,
        modules: uModules,
        max_depots: Math.max(Number(data.license.max_depots) || 0, getMaxDepotsForPlan(uPlan)),
        organization_name: data.license.organization_name || cleanOrg,
        contact_email: data.license.contact_email || cleanEmail,
        client_supabase_url: data.license.client_supabase_url || cleanUrl,
        is_active: data.license.is_active !== false,
        created_at: current.created_at || new Date().toISOString(),
        expires_at: data.license.expires_at || null,
        last_verified_at: new Date().toISOString(),
        status: 'valid',
        signed_token: signedToken,
        offline_until: signedToken?.offline_until,
      });

      saveLicenseLocally(updated);
      return {
        success: true,
        license: updated,
        message: data.message || `Licence mise à niveau vers ${updated.plan_type.toUpperCase()}`,
      };
    }

    return {
      success: false,
      message: data?.error || data?.message || 'Mise à niveau refusée par le serveur maître.',
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Erreur communication serveur maître : ${err?.message || 'Inconnue'}`,
    };
  }
}

export const clearSavedLicense = removeLicense;
export const updateLicenseContactEmail = associateContactEmailWithLicense;

export { syncLicenseTokenToClientDb } from './licenseTokenService';

/**
 * Synchronizes the verified license to the Client Supabase Database (license_config & app_settings tables).
 * Technical ceilings (max_references / max_tools) are NEVER stored per client.
 */
export async function syncLicenseToClientDatabase(
  license: LicenseInfo,
  client?: any
): Promise<{ success: boolean; message: string }> {
  if (!client) {
    return { success: false, message: 'Client Supabase non connecté' };
  }

  const canonicalPlan = normalizePlanType(license.plan || license.plan_type || 'free', license.license_key);
  const limits = plan_limits(canonicalPlan);
  const modules = normalizeLicenseModules(license.modules, false, canonicalPlan);
  const pDepots = Math.max(Number(license.max_depots) || 0, limits.max_depots);

  try {
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session) {
      return {
        success: true,
        message: `Licence ${canonicalPlan.toUpperCase()} chargée.`,
      };
    }

    if (license.license_key && !license.license_key.toUpperCase().startsWith('TOT-STOCK-FREE')) {
      const nowIso = new Date().toISOString();
      await updateCompanyLicenseInfoShared(client, (existingLicObj) => {
        const next = {
          ...existingLicObj,
          id: license.id,
          license_key: license.license_key,
          organization_name: license.organization_name,
          client_supabase_url: license.client_supabase_url,
          contact_email: license.contact_email,
          billing_cycle: license.billing_cycle,
          plan: canonicalPlan,
          plan_type: canonicalPlan,
          modules,
          max_depots: pDepots,
          is_active: license.is_active !== false,
          status: license.is_active === false ? 'inactive' : 'valid',
          created_at: license.created_at,
          expires_at: license.expires_at,
          last_verified_at: license.last_verified_at || nowIso,
          signed_token: license.signed_token ? convertLegacyLicenseToken(license.signed_token) : undefined,
          offline_until: license.offline_until,
        };
        delete (next as any).max_references;
        delete (next as any).max_tools;
        return next;
      });
    }

    if (license.signed_token) {
      try {
        const edgeRes = await syncLicenseTokenToClientDb(client, license.signed_token);
        if (edgeRes.success) {
          return {
            success: true,
            message: `Base client synchronisée avec succès via sync-license (${canonicalPlan.toUpperCase()}, modules : ${modules.join(', ')}, ${pDepots} dépôts).`,
          };
        }
      } catch {}
    }

    return {
      success: true,
      message: `Licence ${canonicalPlan.toUpperCase()} active synchronisée (modules : ${modules.join(', ')}, ${pDepots >= 99999 ? 'Illimité' : pDepots + ' dépôts'}).`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || 'Erreur lors de la synchronisation de licence client',
    };
  }
}
