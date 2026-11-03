import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  plan_limits,
  PLAN_LABELS,
  CanonicalLicensePlan,
  LicenseModule,
  isRecognizedLicensePlan,
  normalizeToCanonicalPlan,
} from '../types';
import {
  verifySignedLicenseToken,
  LICENSE_SIGNING_KEYS,
  CURRENT_KEY_ID,
} from '../services/licenseTokenService';
import { translations, SUPPORTED_LANGUAGES } from '../i18n/translations';
import { tr, translateTextToNl } from '../i18n/dutchTranslator';
import { MENU_PERMISSION_GROUPS } from '../data/permissionMatrix';

interface ParsedSqlPlanLimit {
  plan: string;
  max_references: number;
  max_depots: number;
  max_users: number;
  default_modules: string[];
}

/**
 * Extrait la fonction SQL `public.plan_limits` d'un fichier .sql et parse chaque bloc jsonb_build_object
 * pour vérifier les plafonds métier définis dans le SQL.
 */
function parseSqlPlanLimits(sqlFilePath: string): Record<string, ParsedSqlPlanLimit> {
  const fullPath = path.resolve(process.cwd(), sqlFilePath);
  const content = fs.readFileSync(fullPath, 'utf-8');

  const fnMatch = content.match(
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.plan_limits\s*\([^)]*\)[\s\S]*?\$\$\s*;/i
  );
  if (!fnMatch) {
    throw new Error(`Fonction public.plan_limits introuvable dans ${sqlFilePath}`);
  }

  const fnBody = fnMatch[0];
  const objectRegex = /jsonb_build_object\s*\(([\s\S]*?)\)\s*;/g;
  const results: Record<string, ParsedSqlPlanLimit> = {};

  let match: RegExpExecArray | null;
  while ((match = objectRegex.exec(fnBody)) !== null) {
    const block = match[1];

    const planMatch = block.match(/'plan'\s*,\s*'([^']+)'/);
    const refsMatch = block.match(/'max_references'\s*,\s*(\d+)/);
    const depotsMatch = block.match(/'max_depots'\s*,\s*(\d+)/);
    const usersMatch = block.match(/'max_users'\s*,\s*(\d+)/);
    const modulesMatch = block.match(/jsonb_build_array\s*\(([^)]*)\)/);

    if (!planMatch || !refsMatch || !depotsMatch || !usersMatch || !modulesMatch) {
      throw new Error(`Bloc jsonb_build_object incomplet dans ${sqlFilePath}: ${block}`);
    }

    const plan = planMatch[1];
    const default_modules = modulesMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);

    results[plan] = {
      plan,
      max_references: Number(refsMatch[1]),
      max_depots: Number(depotsMatch[1]),
      max_users: Number(usersMatch[1]),
      default_modules,
    };
  }

  return results;
}

describe('plan_limits – Source de vérité unique (free, sta, pro, ent)', () => {
  const expectedBusinessDefinitions: Record<
    CanonicalLicensePlan,
    {
      plan: CanonicalLicensePlan;
      max_references: number;
      max_depots: number;
      max_users: number;
      default_modules: LicenseModule[];
    }
  > = {
    free: {
      plan: 'free',
      max_references: 50,
      max_depots: 1,
      max_users: 99999,
      default_modules: ['stock'],
    },
    sta: {
      plan: 'sta',
      max_references: 300,
      max_depots: 3,
      max_users: 99999,
      default_modules: ['stock'],
    },
    pro: {
      plan: 'pro',
      max_references: 1000,
      max_depots: 10,
      max_users: 99999,
      default_modules: ['stock', 'outils', 'rapports'],
    },
    ent: {
      plan: 'ent',
      max_references: 99999,
      max_depots: 99999,
      max_users: 99999,
      default_modules: ['stock', 'outils', 'formation', 'rapports'],
    },
  };

  it('vérifie que PLAN_LABELS expose exactement Free, STA, PRO, ENT', () => {
    expect(PLAN_LABELS).toEqual({
      free: 'Free',
      sta: 'STA',
      pro: 'PRO',
      ent: 'ENT',
    });
  });

  it('vérifie que supabase-master/schema_master_licenses.sql correspond aux définitions métier (free, sta, pro, ent)', () => {
    const masterLimits = parseSqlPlanLimits('supabase-master/schema_master_licenses.sql');
    expect(masterLimits).toEqual(expectedBusinessDefinitions);
  });

  it('vérifie que supabase-client/02_rls_hardening.sql est une copie identique de la source de vérité maître', () => {
    const masterLimits = parseSqlPlanLimits('supabase-master/schema_master_licenses.sql');
    const clientLimits = parseSqlPlanLimits('supabase-client/02_rls_hardening.sql');
    expect(clientLimits).toEqual(masterLimits);
  });

  it('vérifie que la fonction TypeScript plan_limits retourne exactement les mêmes plafonds pour free, sta, pro, ent', () => {
    const masterLimits = parseSqlPlanLimits('supabase-master/schema_master_licenses.sql');

    for (const planCode of ['free', 'sta', 'pro', 'ent'] as CanonicalLicensePlan[]) {
      const tsLimits = plan_limits(planCode);
      expect(tsLimits).toEqual(expectedBusinessDefinitions[planCode]);
      expect(tsLimits).toEqual(masterLimits[planCode]);
    }
  });

  it('vérifie la normalisation en lecture seule des alias (artisan/starter/standard -> sta, pme/professionnel -> pro, enterprise/entreprise -> ent)', () => {
    expect(normalizeToCanonicalPlan('artisan')).toBe('sta');
    expect(normalizeToCanonicalPlan('starter')).toBe('sta');
    expect(normalizeToCanonicalPlan('standard')).toBe('sta');
    expect(normalizeToCanonicalPlan('pme')).toBe('pro');
    expect(normalizeToCanonicalPlan('professionnel')).toBe('pro');
    expect(normalizeToCanonicalPlan('enterprise')).toBe('ent');
    expect(normalizeToCanonicalPlan('entreprise')).toBe('ent');

    expect(plan_limits('artisan')).toEqual(expectedBusinessDefinitions.sta);
    expect(plan_limits('starter')).toEqual(expectedBusinessDefinitions.sta);
    expect(plan_limits('standard')).toEqual(expectedBusinessDefinitions.sta);
    expect(plan_limits('pme')).toEqual(expectedBusinessDefinitions.pro);
    expect(plan_limits('professionnel')).toEqual(expectedBusinessDefinitions.pro);
    expect(plan_limits('enterprise')).toEqual(expectedBusinessDefinitions.ent);
    expect(plan_limits('entreprise')).toEqual(expectedBusinessDefinitions.ent);

    expect(isRecognizedLicensePlan('sta')).toBe(true);
    expect(isRecognizedLicensePlan('artisan')).toBe(true);
    expect(isRecognizedLicensePlan('gold')).toBe(false);
  });
});

describe('Jetons de licence signés Ed25519 – Vérification de signature avant normalisation (Point 2)', () => {
  const TEST_KID = 'ed25519-test-v25';
  let privateKey: CryptoKey;

  async function signTestTokenClaims(claims: {
    kid?: string;
    license_key: string;
    plan: string;
    modules: string[];
    max_depots: number;
    organization_name: string;
    client_project_ref: string;
    issued_at: string;
    offline_until: string;
    expires_at: string | null;
  }) {
    const kid = claims.kid || TEST_KID;
    const payloadV5 = [
      kid,
      claims.license_key.trim().toUpperCase(),
      claims.plan,
      claims.modules.join(','),
      claims.max_depots,
      claims.organization_name,
      claims.client_project_ref,
      claims.issued_at,
      claims.offline_until,
      claims.expires_at || 'NONE',
    ].join('|');

    const msgBytes = new TextEncoder().encode(payloadV5);
    const sigBuffer = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, msgBytes);
    const sigHex = Array.from(new Uint8Array(sigBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return {
      ...claims,
      kid,
      signature: sigHex,
      token_version: 5,
    };
  }

  beforeAll(async () => {
    const keyPair = (await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    privateKey = keyPair.privateKey;
    const spkiBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    const publicKeyB64 = Buffer.from(spkiBuffer).toString('base64');

    LICENSE_SIGNING_KEYS[TEST_KID] = {
      kid: TEST_KID,
      publicKeyB64,
      retired_at: null,
    };
  });

  afterAll(() => {
    delete LICENSE_SIGNING_KEYS[TEST_KID];
  });

  it("1. accepte un jeton signé avec 'artisan' (v24) et le normalise en 'sta' après vérification", async () => {
    const signedToken = await signTestTokenClaims({
      license_key: 'TOT-STOCK-ARTISAN-11223344-55667788',
      plan: 'artisan',
      modules: ['stock'],
      max_depots: 3,
      organization_name: 'Menuiserie Test',
      client_project_ref: 'abcdefghijklmnop',
      issued_at: new Date().toISOString(),
      offline_until: new Date(Date.now() + 7 * 86400000).toISOString(),
      expires_at: null,
    });

    const res = await verifySignedLicenseToken(signedToken, 'https://abcdefghijklmnop.supabase.co');
    expect(res.valid).toBe(true);
    expect(res.token?.plan).toBe('sta');
    expect(res.token?.plan_type).toBe('sta');
    expect(res.token?.max_depots).toBe(3);
    expect(res.token?.modules).toEqual(['stock']);
  });

  it("2. accepte un jeton signé avec 'pro' et conserve le code canonique 'pro'", async () => {
    const signedToken = await signTestTokenClaims({
      license_key: 'TOT-STOCK-PRO-AABBCCDD-EEFF0011',
      plan: 'pro',
      modules: ['stock', 'outils', 'rapports'],
      max_depots: 10,
      organization_name: 'BTP Pro SAS',
      client_project_ref: 'abcdefghijklmnop',
      issued_at: new Date().toISOString(),
      offline_until: new Date(Date.now() + 7 * 86400000).toISOString(),
      expires_at: null,
    });

    const res = await verifySignedLicenseToken(signedToken, 'https://abcdefghijklmnop.supabase.co');
    expect(res.valid).toBe(true);
    expect(res.token?.plan).toBe('pro');
    expect(res.token?.plan_type).toBe('pro');
    expect(res.token?.max_depots).toBe(10);
    expect(res.token?.modules).toEqual(['stock', 'outils', 'rapports']);
  });

  it("3. rejette un jeton signé avec une formule inconnue", async () => {
    const signedToken = await signTestTokenClaims({
      license_key: 'TOT-STOCK-GOLD-11223344-55667788',
      plan: 'gold_unlimited',
      modules: ['stock'],
      max_depots: 99,
      organization_name: 'Client Inconnu',
      client_project_ref: 'abcdefghijklmnop',
      issued_at: new Date().toISOString(),
      offline_until: new Date(Date.now() + 7 * 86400000).toISOString(),
      expires_at: null,
    });

    const res = await verifySignedLicenseToken(signedToken, 'https://abcdefghijklmnop.supabase.co');
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/inconnue|non autorisée/i);
  });

  it("4. rejette un jeton dont la signature ou la formule a été altérée", async () => {
    const signedToken = await signTestTokenClaims({
      license_key: 'TOT-STOCK-STA-11223344-55667788',
      plan: 'sta',
      modules: ['stock'],
      max_depots: 3,
      organization_name: 'Client Test',
      client_project_ref: 'abcdefghijklmnop',
      issued_at: new Date().toISOString(),
      offline_until: new Date(Date.now() + 7 * 86400000).toISOString(),
      expires_at: null,
    });

    // Altération de la signature
    const tamperedSig = {
      ...signedToken,
      signature: signedToken.signature.replace(/^[0-9a-f]{4}/, (m) => (m === '0000' ? 'ffff' : '0000')),
    };
    const resSig = await verifySignedLicenseToken(tamperedSig, 'https://abcdefghijklmnop.supabase.co');
    expect(resSig.valid).toBe(false);
    expect(resSig.reason).toMatch(/Signature cryptographique asymétrique Ed25519 invalide/i);

    // Altération du plan ('sta' remplacé par 'ent' sans re-signer)
    const tamperedPlan = {
      ...signedToken,
      plan: 'ent',
    };
    const resPlan = await verifySignedLicenseToken(tamperedPlan, 'https://abcdefghijklmnop.supabase.co');
    expect(resPlan.valid).toBe(false);
    expect(resPlan.reason).toMatch(/Signature cryptographique asymétrique Ed25519 invalide/i);
  });
});

describe('Traduction néerlandaise (nl) – i18n & inline UI', () => {
  it('inclut le néerlandais (nl) dans SUPPORTED_LANGUAGES et possède exactement toutes les clés de fr et en', () => {
    expect(SUPPORTED_LANGUAGES.map((l) => l.code)).toEqual(['fr', 'en', 'nl']);
    const frKeys = Object.keys(translations.fr).sort();
    const enKeys = Object.keys(translations.en).sort();
    const nlKeys = Object.keys(translations.nl).sort();

    expect(nlKeys).toEqual(frKeys);
    expect(nlKeys).toEqual(enKeys);

    for (const key of frKeys) {
      const val = (translations.nl as Record<string, string>)[key];
      expect(typeof val).toBe('string');
      expect(val.trim().length).toBeGreaterThan(0);
    }
  });

  it('traduit les expressions inline tr(language, fr, en) et toute la matrice des permissions en néerlandais', () => {
    expect(tr('fr', 'Fermer', 'Close')).toBe('Fermer');
    expect(tr('en', 'Fermer', 'Close')).toBe('Close');
    expect(tr('nl', 'Fermer', 'Close')).toBe('Sluiten');
    expect(tr('nl', 'Magasins & Dépôts', 'Warehouses & Depots')).toBe('Magazijnen & Depots');
    expect(tr('nl', 'Panier 2', 'Basket 2')).toBe('Mandje 2');

    for (const group of MENU_PERMISSION_GROUPS) {
      const nlGroupName = tr('nl', group.nameFr, group.nameEn);
      const nlTagline = tr('nl', group.taglineFr, group.taglineEn);
      expect(nlGroupName).not.toBe(group.nameEn);
      expect(nlTagline).not.toBe(group.taglineEn);

      for (const btn of group.buttons) {
        const nlLabel = tr('nl', btn.labelFr, btn.labelEn);
        const nlDesc = tr('nl', btn.descFr, btn.descEn);
        expect(nlLabel).not.toBe(btn.labelEn);
        expect(nlDesc).not.toBe(btn.descEn);
        expect(translateTextToNl(btn.labelEn, btn.labelFr).length).toBeGreaterThan(0);
      }
    }
  });
});

