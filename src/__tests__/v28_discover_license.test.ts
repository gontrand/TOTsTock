import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateDiscoverTargetUrl,
  normalizeDiscoverTargetUrl,
  isStrictProjectUrlMatch,
  verifyProjectOwnershipProof,
} from '../../supabase-master/functions/_shared/discover';
import {
  discoverLicenseByProjectUrl,
  recoverCompanyLicenseFromServerAndClientDb,
  DISCOVER_COOLDOWN_KEY,
  DISCOVER_COOLDOWN_MS,
  getSavedLicense,
} from '../services/licenseService';
import {
  LICENSE_SIGNING_KEYS,
  CURRENT_KEY_ID,
  verifySignedLicenseToken,
} from '../services/licenseTokenService';
import { masterSupabase } from '../services/masterSupabase';
import type { SignedLicenseToken } from '../types';

const rootDir = process.cwd();

describe('v28 & v31 — Découverte automatique de licence par URL de projet et preuve de session', () => {
  describe('1. Validation anti-SSRF et rejet d\'URL (validateDiscoverTargetUrl)', () => {
    it('accepte une URL HTTPS valide de projet Supabase ou domaine public', () => {
      const res1 = validateDiscoverTargetUrl('https://gdiyfvvjtidhraguuxjv.supabase.co');
      expect(res1.valid).toBe(true);
      expect(res1.normalizedUrl).toBe('https://gdiyfvvjtidhraguuxjv.supabase.co');
      expect(res1.projectRef).toBe('gdiyfvvjtidhraguuxjv');

      const res2 = validateDiscoverTargetUrl('https://gdiyfvvjtidhraguuxjv.supabase.co:443/rest/v1/');
      expect(res2.valid).toBe(true);
      expect(res2.normalizedUrl).toBe('https://gdiyfvvjtidhraguuxjv.supabase.co');
    });

    it('rejette le schéma non sécurisé http://', () => {
      const res = validateDiscoverTargetUrl('http://gdiyfvvjtidhraguuxjv.supabase.co');
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('URL_NOT_HTTPS');
    });

    it('rejette les adresses IP (IPv4 et IPv6)', () => {
      expect(validateDiscoverTargetUrl('https://127.0.0.1').valid).toBe(false);
      expect(validateDiscoverTargetUrl('https://127.0.0.1').reason).toBe('URL_IS_IP_ADDRESS');
      expect(validateDiscoverTargetUrl('https://169.254.169.254').valid).toBe(false);
      expect(validateDiscoverTargetUrl('https://192.168.1.10').valid).toBe(false);
      expect(validateDiscoverTargetUrl('https://[::1]').valid).toBe(false);
      expect(validateDiscoverTargetUrl('https://[fe80::1]').valid).toBe(false);
    });

    it('rejette localhost et ses sous-domaines', () => {
      expect(validateDiscoverTargetUrl('https://localhost').valid).toBe(false);
      expect(validateDiscoverTargetUrl('https://api.localhost').valid).toBe(false);
    });

    it('rejette tout port autre que 443 (ex: port 8080, 5432, 3000)', () => {
      const res = validateDiscoverTargetUrl('https://gdiyfvvjtidhraguuxjv.supabase.co:8080');
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('URL_INVALID_PORT');
    });

    it('rejette toute URL contenant des identifiants user:pass@', () => {
      const res = validateDiscoverTargetUrl('https://user:pass@gdiyfvvjtidhraguuxjv.supabase.co');
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('URL_HAS_CREDENTIALS');
    });

    it('rejette les domaines internes (.local, .internal, .lan, .corp, sans TLD)', () => {
      expect(validateDiscoverTargetUrl('https://supabase.local').valid).toBe(false);
      expect(validateDiscoverTargetUrl('https://db.internal').valid).toBe(false);
      expect(validateDiscoverTargetUrl('https://metadata.google.internal').valid).toBe(false);
      expect(validateDiscoverTargetUrl('https://intranet-server').valid).toBe(false);
    });

    it('rejette les chemins arbitraires ou paramètres de requête', () => {
      expect(validateDiscoverTargetUrl('https://gdiyfvvjtidhraguuxjv.supabase.co/admin/secret').valid).toBe(false);
      expect(validateDiscoverTargetUrl('https://gdiyfvvjtidhraguuxjv.supabase.co?redirect=http://evil.com').valid).toBe(false);
    });
  });

  describe('2. Normalisation et correspondance stricte d\'URL', () => {
    it('normalise la casse (majuscules), les barres finales et le suffixe /rest/v1', () => {
      expect(normalizeDiscoverTargetUrl('HTTPS://GDIYFVVJTIDHRAGUUXJV.SUPABASE.CO/')).toBe(
        'https://gdiyfvvjtidhraguuxjv.supabase.co'
      );
      expect(normalizeDiscoverTargetUrl('https://Gdiyfvvjtidhraguuxjv.Supabase.co/rest/v1/')).toBe(
        'https://gdiyfvvjtidhraguuxjv.supabase.co'
      );
      expect(normalizeDiscoverTargetUrl('https://gdiyfvvjtidhraguuxjv.supabase.co///')).toBe(
        'https://gdiyfvvjtidhraguuxjv.supabase.co'
      );
    });

    it('vérifie la correspondance stricte et refuse systématiquement une licence sans URL', () => {
      const proven = 'https://gdiyfvvjtidhraguuxjv.supabase.co';
      expect(isStrictProjectUrlMatch('https://GDIYFVVJTIDHRAGUUXJV.supabase.co/rest/v1/', proven)).toBe(true);
      expect(isStrictProjectUrlMatch('https://otherproject.supabase.co', proven)).toBe(false);
      expect(isStrictProjectUrlMatch('', proven)).toBe(false);
      expect(isStrictProjectUrlMatch(null, proven)).toBe(false);
      expect(isStrictProjectUrlMatch(undefined, proven)).toBe(false);
    });
  });

  describe('3. Preuve d\'appartenance via appel simulé à /auth/v1/user (verifyProjectOwnershipProof)', () => {
    const validUrl = 'https://gdiyfvvjtidhraguuxjv.supabase.co/';
    const validAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon_key_payload_valid';
    const validAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.access_token_payload_valid';

    it('accepte une réponse HTTP 200 contenant un identifiant utilisateur valide et appelle uniquement /auth/v1/user', async () => {
      let calledUrl = '';
      let calledInit: RequestInit | undefined;

      const mockFetch: typeof fetch = async (input, init) => {
        calledUrl = String(input);
        calledInit = init;
        return new Response(
          JSON.stringify({ id: 'user-uuid-1234', email: 'admin@client.fr' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const res = await verifyProjectOwnershipProof({
        clientSupabaseUrl: validUrl,
        clientAnonKey: validAnonKey,
        clientAccessToken: validAccessToken,
        fetchFn: mockFetch,
      });

      expect(res.verified).toBe(true);
      expect(res.userId).toBe('user-uuid-1234');
      expect(calledUrl).toBe('https://gdiyfvvjtidhraguuxjv.supabase.co/auth/v1/user');
      expect(calledInit?.redirect).toBe('manual');
      expect((calledInit?.headers as Record<string, string>)?.apikey).toBe(validAnonKey);
      expect((calledInit?.headers as Record<string, string>)?.Authorization).toBe(`Bearer ${validAccessToken}`);
    });

    it('rejette une réponse HTTP 401 (jeton de session invalide ou expiré)', async () => {
      const mockFetch: typeof fetch = async () =>
        new Response(JSON.stringify({ message: 'Invalid token' }), { status: 401 });

      const res = await verifyProjectOwnershipProof({
        clientSupabaseUrl: validUrl,
        clientAnonKey: validAnonKey,
        clientAccessToken: validAccessToken,
        fetchFn: mockFetch,
      });

      expect(res.verified).toBe(false);
      expect(res.httpStatus).toBe(401);
      expect(res.reason).toBe('HTTP_401');
    });

    it('rejette si le délai maximal (timeout) est dépassé', async () => {
      const mockFetch: typeof fetch = async (_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const abortErr = new Error('The operation was aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        });
      };

      const res = await verifyProjectOwnershipProof({
        clientSupabaseUrl: validUrl,
        clientAnonKey: validAnonKey,
        clientAccessToken: validAccessToken,
        fetchFn: mockFetch,
        timeoutMs: 30,
      });

      expect(res.verified).toBe(false);
      expect(res.reason).toBe('TIMEOUT');
    });

    it('ignore et rejette toute redirection HTTP (301/302/307)', async () => {
      const mockFetch: typeof fetch = async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'https://evil.example.com/auth/v1/user' },
        });

      const res = await verifyProjectOwnershipProof({
        clientSupabaseUrl: validUrl,
        clientAnonKey: validAnonKey,
        clientAccessToken: validAccessToken,
        fetchFn: mockFetch,
      });

      expect(res.verified).toBe(false);
      expect(res.reason).toBe('REDIRECT_REJECTED');
    });

    it('rejette une réponse dont la taille dépasse 100 Ko', async () => {
      const oversizedPayload = JSON.stringify({
        id: 'user-uuid-1234',
        padding: 'x'.repeat(105 * 1024),
      });
      const mockFetch: typeof fetch = async () =>
        new Response(oversizedPayload, { status: 200 });

      const res = await verifyProjectOwnershipProof({
        clientSupabaseUrl: validUrl,
        clientAnonKey: validAnonKey,
        clientAccessToken: validAccessToken,
        fetchFn: mockFetch,
      });

      expect(res.verified).toBe(false);
      expect(res.reason).toBe('RESPONSE_TOO_LARGE');
    });
  });

  describe('4. Côté application — discoverLicenseByProjectUrl', () => {
    const projectUrl = 'https://gdiyfvvjtidhraguuxjv.supabase.co';
    const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon_key_payload_valid';
    const accessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.access_token_payload_valid';

    const makeValidSignedToken = (url = projectUrl): SignedLicenseToken => ({
      kid: 'ed25519-2026-v2',
      license_key: 'TOT-STOCK-PRO-11223344-55667788',
      organization_name: 'Entreprise Test v28',
      plan: 'pro',
      plan_type: 'pro',
      modules: ['stock', 'outils', 'rapports'],
      max_depots: 10,
      client_project_ref: 'gdiyfvvjtidhraguuxjv',
      client_supabase_url: url,
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 365 * 86400000).toISOString(),
      offline_until: new Date(Date.now() + 7 * 86400000).toISOString(),
      token_version: 5,
      signature: 'deadbeef',
      raw_token: 'payload.deadbeef',
    });

    beforeEach(() => {
      const store = new Map<string, string>();
      (globalThis as any).localStorage = {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
          store.set(k, String(v));
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => {
          store.clear();
        },
      };
    });

    it('enregistre la licence quand discover trouve une licence active avec un signed_token valide', async () => {
      const validToken = makeValidSignedToken();

      const res = await discoverLicenseByProjectUrl(projectUrl, anonKey, accessToken, {
        invokeFn: async (fnName, { body }) => {
          expect(fnName).toBe('APP_TOT-Stock_licenses');
          expect(body.action).toBe('discover');
          expect(body.client_supabase_url).toBe(projectUrl);
          expect(body.client_anon_key).toBe(anonKey);
          expect(body.client_access_token).toBe(accessToken);

          return {
            data: {
              success: true,
              license: {
                id: 'lic-1',
                license_key: validToken.license_key,
                plan: 'pro',
                plan_type: 'pro',
                modules: validToken.modules,
                max_depots: 10,
                organization_name: 'Entreprise Test v28',
                client_supabase_url: projectUrl,
                is_active: true,
              },
              signed_token: validToken,
            },
            error: null,
          };
        },
        verifyTokenFn: async () => ({
          valid: true,
          token: validToken,
        }),
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('found');
      expect(res.license?.license_key).toBe('TOT-STOCK-PRO-11223344-55667788');
      expect(res.license?.plan_type).toBe('pro');

      const saved = getSavedLicense();
      expect(saved.license_key).toBe('TOT-STOCK-PRO-11223344-55667788');
      expect(saved.plan_type).toBe('pro');
    });

    it('rejette la licence si le jeton est invalide ou signé pour une autre URL de projet', async () => {
      const tokenForOtherProject = makeValidSignedToken('https://otherproject.supabase.co');

      const res = await discoverLicenseByProjectUrl(projectUrl, anonKey, accessToken, {
        invokeFn: async () => ({
          data: {
            success: true,
            license: {
              id: 'lic-2',
              license_key: tokenForOtherProject.license_key,
              plan: 'pro',
              plan_type: 'pro',
              modules: tokenForOtherProject.modules,
              max_depots: 10,
              organization_name: 'Autre Entreprise',
              client_supabase_url: 'https://otherproject.supabase.co',
              is_active: true,
            },
            signed_token: tokenForOtherProject,
          },
          error: null,
        }),
        verifyTokenFn: async (_rawToken, currentClientUrl) => {
          expect(currentClientUrl).toBe(projectUrl);
          return {
            valid: false,
            reason: 'Ce jeton de licence appartient à un autre projet Supabase.',
          };
        },
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('invalid_token');

      // La licence locale doit rester sur le forfait gratuit par défaut
      const saved = getSavedLicense();
      expect(saved.plan_type).toBe('free');
    });

    it('mémorise tot_license_discover_ts quand la réponse est "aucune licence" et bloque tout nouvel essai automatique pendant 24 h (sauf force: true)', async () => {
      let callCount = 0;
      const mockInvoke = async () => {
        callCount += 1;
        return {
          data: {
            success: false,
            code: 'LICENSE_NOT_FOUND',
            message: 'Aucune licence enregistrée pour ce projet.',
          },
          error: { status: 404, message: 'Not Found' },
        };
      };

      // 1er appel automatique : interroge le serveur maître et enregistre l'horodatage
      const firstAttempt = await discoverLicenseByProjectUrl(projectUrl, anonKey, accessToken, {
        force: false,
        invokeFn: mockInvoke,
      });
      expect(firstAttempt.success).toBe(false);
      expect(firstAttempt.status).toBe('not_found');
      expect(callCount).toBe(1);

      const savedTs = Number(localStorage.getItem(DISCOVER_COOLDOWN_KEY));
      expect(savedTs).toBeGreaterThan(0);

      // 2e appel automatique immédiat (< 24 h) : bloqué localement sans appel réseau
      const secondAttempt = await discoverLicenseByProjectUrl(projectUrl, anonKey, accessToken, {
        force: false,
        invokeFn: mockInvoke,
      });
      expect(secondAttempt.success).toBe(false);
      expect(secondAttempt.status).toBe('cooldown');
      expect(callCount).toBe(1); // Aucun appel réseau supplémentaire

      // Appel manuel via le bouton "Rechercher ma licence automatiquement" (force: true) : ignore le délai de 24 h
      const forcedAttempt = await discoverLicenseByProjectUrl(projectUrl, anonKey, accessToken, {
        force: true,
        invokeFn: mockInvoke,
      });
      expect(forcedAttempt.status).toBe('not_found');
      expect(callCount).toBe(2);

      // Simulation de l'expiration du délai de 24 h + 1 minute
      localStorage.setItem(DISCOVER_COOLDOWN_KEY, String(Date.now() - DISCOVER_COOLDOWN_MS - 60_000));
      const after24hAttempt = await discoverLicenseByProjectUrl(projectUrl, anonKey, accessToken, {
        force: false,
        invokeFn: mockInvoke,
      });
      expect(after24hAttempt.status).toBe('not_found');
      expect(callCount).toBe(3);
    });
  });

  describe('5. v31 — Suppression de discover_client_license(url) et scénario « changement de téléphone »', () => {
    const projectUrl = 'https://gdiyfvvjtidhraguuxjv.supabase.co';
    const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon_key_payload_valid';
    const accessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.access_token_session_valid';

    let originalPubKeyB64 = '';
    let testPrivateKey: CryptoKey;

    beforeAll(async () => {
      originalPubKeyB64 = LICENSE_SIGNING_KEYS[CURRENT_KEY_ID].publicKeyB64;
      const kp = (await crypto.subtle.generateKey(
        { name: 'Ed25519' },
        true,
        ['sign', 'verify']
      )) as CryptoKeyPair;
      testPrivateKey = kp.privateKey;
      const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
      LICENSE_SIGNING_KEYS[CURRENT_KEY_ID].publicKeyB64 = Buffer.from(spki).toString('base64');
    });

    afterAll(() => {
      LICENSE_SIGNING_KEYS[CURRENT_KEY_ID].publicKeyB64 = originalPubKeyB64;
      vi.restoreAllMocks();
    });

    async function createRealSignedToken(opts?: {
      licenseKey?: string;
      plan?: 'sta' | 'pro' | 'ent';
      modules?: ('stock' | 'outils' | 'formation' | 'rapports')[];
      maxDepots?: number;
      orgName?: string;
      clientUrl?: string;
      projectRef?: string;
    }): Promise<SignedLicenseToken> {
      const licenseKey = opts?.licenseKey || 'TOT-STOCK-PRO-11223344-55667788';
      const plan = opts?.plan || 'pro';
      const modules = opts?.modules || ['stock', 'outils', 'rapports'];
      const maxDepots = opts?.maxDepots || 10;
      const orgName = opts?.orgName || 'Entreprise Test v31';
      const clientUrl = opts?.clientUrl || projectUrl;
      const projectRef = opts?.projectRef || 'gdiyfvvjtidhraguuxjv';
      const issuedAt = new Date().toISOString();
      const offlineUntil = new Date(Date.now() + 7 * 86400000).toISOString();
      const expiresAt = new Date(Date.now() + 365 * 86400000).toISOString();

      const payloadToSign = [
        CURRENT_KEY_ID,
        licenseKey,
        plan,
        modules.join(','),
        maxDepots,
        orgName,
        projectRef,
        issuedAt,
        offlineUntil,
        expiresAt,
      ].join('|');

      const sigBuf = await crypto.subtle.sign(
        { name: 'Ed25519' },
        testPrivateKey,
        new TextEncoder().encode(payloadToSign)
      );
      const signature = Buffer.from(sigBuf).toString('hex');

      const claims = {
        kid: CURRENT_KEY_ID,
        license_key: licenseKey,
        organization_name: orgName,
        plan,
        plan_type: plan,
        modules,
        max_depots: maxDepots,
        client_project_ref: projectRef,
        client_supabase_url: clientUrl,
        issued_at: issuedAt,
        expires_at: expiresAt,
        offline_until: offlineUntil,
        token_version: 5 as const,
      };
      const rawToken = `${Buffer.from(JSON.stringify(claims)).toString('base64')}.${signature}`;

      return {
        ...claims,
        signature,
        raw_token: rawToken,
      };
    }

    function createClientSupabaseDouble(config: {
      appSettingsRows?: Array<{ key: string; value: string }>;
      licenseConfigRows?: Array<Record<string, any>>;
      session?: { access_token: string; user: { id: string; email: string } } | null;
      userRow?: { role_id: number } | null;
      roleRow?: { permissions: string[] } | null;
    }) {
      const writtenAppSettings: Array<any> = [];
      const writtenLicenseConfig: Array<any> = [];
      const syncedTokens: Array<any> = [];

      const clientDouble = {
        supabaseKey: anonKey,
        writtenAppSettings,
        writtenLicenseConfig,
        syncedTokens,
        auth: {
          getSession: vi.fn(async () => ({
            data: { session: config.session ?? null },
            error: null,
          })),
        },
        functions: {
          invoke: vi.fn(async (fnName: string, args: any) => {
            if (fnName === 'sync-license') {
              syncedTokens.push(args?.body?.signed_token);
              return { data: { success: true }, error: null };
            }
            return { data: null, error: null };
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'app_settings') {
            return {
              select: () => ({
                in: async () => ({
                  data: config.appSettingsRows ?? [],
                  error: null,
                }),
                eq: () => ({
                  maybeSingle: async () => {
                    const row = (config.appSettingsRows ?? []).find(
                      (r) => r.key === 'company_license_info'
                    );
                    return { data: row || null, error: null };
                  },
                }),
              }),
              upsert: async (rows: any) => {
                writtenAppSettings.push(rows);
                return { data: rows, error: null };
              },
            };
          }
          if (table === 'license_config') {
            return {
              select: () => ({
                limit: async () => ({
                  data: config.licenseConfigRows ?? [],
                  error: null,
                }),
              }),
              upsert: async (rows: any) => {
                writtenLicenseConfig.push(rows);
                return { data: rows, error: null };
              },
            };
          }
          if (table === 'users') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: config.userRow ?? { role_id: 1 },
                    error: null,
                  }),
                }),
                ilike: () => ({
                  maybeSingle: async () => ({
                    data: config.userRow ?? { role_id: 1 },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'roles') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: config.roleRow ?? { permissions: ['perm_config_license'] },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          };
        }),
      };

      return clientDouble;
    }

    let invokeSpy = vi.fn();

    beforeEach(() => {
      vi.restoreAllMocks();
      invokeSpy = vi.fn();
      Object.defineProperty(masterSupabase, 'functions', {
        value: { invoke: invokeSpy },
        configurable: true,
        writable: true,
      });

      const store = new Map<string, string>();
      store.set('tqt_company_url', projectUrl);
      store.set('tqt_company_key', anonKey);
      (globalThis as any).localStorage = {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
          store.set(k, String(v));
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => {
          store.clear();
        },
      };
    });

    it('supprime discover_client_license(TEXT) de schema_master_licenses.sql et de src/', () => {
      const masterSql = fs.readFileSync(
        path.join(rootDir, 'supabase-master/schema_master_licenses.sql'),
        'utf-8'
      );
      expect(masterSql).toContain('DROP FUNCTION IF EXISTS public.discover_client_license(TEXT);');
      expect(masterSql).not.toContain('CREATE OR REPLACE FUNCTION public.discover_client_license');
      expect(masterSql).not.toContain('GRANT EXECUTE ON FUNCTION public.discover_client_license');

      const licenseServiceCode = fs.readFileSync(
        path.join(rootDir, 'src/services/licenseService.ts'),
        'utf-8'
      );
      expect(licenseServiceCode).not.toContain('discover_client_license');
    });

    it('Scénario 1 — Téléphone neuf, licence présente dans la base du client : retrouve la licence payante sans appel discover par URL', async () => {
      const validToken = await createRealSignedToken({
        licenseKey: 'TOT-STOCK-PRO-AABBCCDD-11223344',
        plan: 'pro',
      });

      invokeSpy.mockImplementation(async (_fnName: string, options: any) => {
        const body = options?.body || {};
        if (body.action === 'validate') {
          return {
            data: {
              success: true,
              license: {
                id: 'lic-client-db',
                license_key: validToken.license_key,
                plan: 'pro',
                plan_type: 'pro',
                modules: validToken.modules,
                max_depots: 10,
                organization_name: 'Entreprise Client DB',
                client_supabase_url: projectUrl,
                is_active: true,
              },
              signed_token: validToken,
            },
            error: null,
          };
        }
        throw new Error(`Appel inattendu : ${body.action}`);
      });

      const clientDouble = createClientSupabaseDouble({
        appSettingsRows: [
          {
            key: 'company_license_info',
            value: JSON.stringify({
              license_key: validToken.license_key,
              plan: 'pro',
              plan_type: 'pro',
              organization_name: 'Entreprise Client DB',
              signed_token: validToken,
            }),
          },
          {
            key: 'license_key',
            value: validToken.license_key,
          },
        ],
        session: {
          access_token: accessToken,
          user: { id: 'admin-1', email: 'admin@client.fr' },
        },
      });

      const recovered = await recoverCompanyLicenseFromServerAndClientDb(
        projectUrl,
        clientDouble
      );

      expect(recovered).not.toBeNull();
      expect(recovered?.license_key).toBe('TOT-STOCK-PRO-AABBCCDD-11223344');
      expect(recovered?.plan_type).toBe('pro');

      // Vérifie qu'aucun appel 'discover' (recherche par URL) n'a été effectué
      const discoverCalls = invokeSpy.mock.calls.filter(
        (call) => (call[1] as any)?.body?.action === 'discover'
      );
      expect(discoverCalls.length).toBe(0);
      expect(getSavedLicense().plan_type).toBe('pro');
    });

    it('Scénario 2 — Téléphone neuf, base client sans licence, licence liée à cette URL côté éditeur : appelle discover avec URL + anonKey + accessToken, vérifie signed_token, enregistre localement et écrit en base client', async () => {
      const validToken = await createRealSignedToken({
        licenseKey: 'TOT-STOCK-ENT-99887766-55443322',
        plan: 'ent',
        modules: ['stock', 'outils', 'formation', 'rapports'],
        maxDepots: 99999,
      });

      // Vérifie que verifySignedLicenseToken valide réellement ce jeton
      const realCheck = await verifySignedLicenseToken(validToken, projectUrl);
      expect(realCheck.valid).toBe(true);

      invokeSpy.mockImplementation(async (fnName: string, options: any) => {
        const body = options?.body || {};
        expect(fnName).toBe('APP_TOT-Stock_licenses');
        expect(body.action).toBe('discover');
        expect(body.client_supabase_url).toBe(projectUrl);
        expect(body.client_anon_key).toBe(anonKey);
        expect(body.client_access_token).toBe(accessToken);

        return {
          data: {
            success: true,
            license: {
              id: 'lic-master-ent',
              license_key: validToken.license_key,
              plan: 'ent',
              plan_type: 'ent',
              modules: validToken.modules,
              max_depots: 99999,
              organization_name: 'Entreprise Test v31',
              client_supabase_url: projectUrl,
              is_active: true,
            },
            signed_token: validToken,
          },
          error: null,
        };
      });

      const clientDouble = createClientSupabaseDouble({
        appSettingsRows: [],
        licenseConfigRows: [],
        session: {
          access_token: accessToken,
          user: { id: 'admin-1', email: 'admin@client.fr' },
        },
        userRow: { role_id: 1 },
      });

      const recovered = await recoverCompanyLicenseFromServerAndClientDb(
        projectUrl,
        clientDouble
      );

      expect(invokeSpy).toHaveBeenCalledTimes(1);
      expect(recovered).not.toBeNull();
      expect(recovered?.license_key).toBe('TOT-STOCK-ENT-99887766-55443322');
      expect(recovered?.plan_type).toBe('ent');

      // Enregistrée localement
      const savedLocal = getSavedLicense();
      expect(savedLocal.license_key).toBe('TOT-STOCK-ENT-99887766-55443322');
      expect(savedLocal.plan_type).toBe('ent');

      // Écrite dans la base client (app_settings + sync-license)
      expect(clientDouble.writtenAppSettings.length).toBeGreaterThan(0);
      expect(clientDouble.syncedTokens.length).toBe(1);
      expect(clientDouble.syncedTokens[0].license_key).toBe('TOT-STOCK-ENT-99887766-55443322');
    });

    it('Scénario 3 — Même cas sans session (utilisateur non connecté) : aucune recherche n\'est faite, la formule free reste en place', async () => {
      const clientDouble = createClientSupabaseDouble({
        appSettingsRows: [],
        licenseConfigRows: [],
        session: null, // Non connecté
      });

      const recovered = await recoverCompanyLicenseFromServerAndClientDb(
        projectUrl,
        clientDouble
      );

      expect(recovered).toBeNull();
      expect(invokeSpy).not.toHaveBeenCalled();
      expect(getSavedLicense().plan_type).toBe('free');
    });

    it('Scénario 4 — Éditeur répond « non trouvée » : pas de nouvel essai avant 24 h', async () => {
      invokeSpy.mockResolvedValue({
        data: {
          success: false,
          code: 'LICENSE_NOT_FOUND',
          message: 'Aucune licence enregistrée pour ce projet.',
        },
        error: { status: 404, message: 'Not Found' },
      });

      const clientDouble = createClientSupabaseDouble({
        appSettingsRows: [],
        licenseConfigRows: [],
        session: {
          access_token: accessToken,
          user: { id: 'admin-1', email: 'admin@client.fr' },
        },
        userRow: { role_id: 1 },
      });

      // 1er essai : appelle discover et reçoit LICENSE_NOT_FOUND
      const first = await recoverCompanyLicenseFromServerAndClientDb(
        projectUrl,
        clientDouble
      );
      expect(first).toBeNull();
      expect(invokeSpy).toHaveBeenCalledTimes(1);
      expect(Number(localStorage.getItem(DISCOVER_COOLDOWN_KEY))).toBeGreaterThan(0);

      // 2e essai avant 24 h : bloqué par le cooldown sans appel réseau
      const second = await recoverCompanyLicenseFromServerAndClientDb(
        projectUrl,
        clientDouble
      );
      expect(second).toBeNull();
      expect(invokeSpy).toHaveBeenCalledTimes(1);
      expect(getSavedLicense().plan_type).toBe('free');
    });

    it('Scénario 5 — Jeton signé pour une autre URL : refusé par verifySignedLicenseToken', async () => {
      const tokenForOtherUrl = await createRealSignedToken({
        licenseKey: 'TOT-STOCK-PRO-OTHERURL-99999999',
        plan: 'pro',
        clientUrl: 'https://otherproject.supabase.co',
        projectRef: 'otherproject',
      });

      invokeSpy.mockResolvedValue({
        data: {
          success: true,
          license: {
            id: 'lic-other',
            license_key: tokenForOtherUrl.license_key,
            plan: 'pro',
            plan_type: 'pro',
            modules: tokenForOtherUrl.modules,
            max_depots: 10,
            organization_name: 'Autre Projet',
            client_supabase_url: 'https://otherproject.supabase.co',
            is_active: true,
          },
          signed_token: tokenForOtherUrl,
        },
        error: null,
      });

      const clientDouble = createClientSupabaseDouble({
        appSettingsRows: [],
        licenseConfigRows: [],
        session: {
          access_token: accessToken,
          user: { id: 'admin-1', email: 'admin@client.fr' },
        },
        userRow: { role_id: 1 },
      });

      const recovered = await recoverCompanyLicenseFromServerAndClientDb(
        projectUrl,
        clientDouble
      );

      expect(invokeSpy).toHaveBeenCalledTimes(1);
      expect(recovered).toBeNull();
      expect(getSavedLicense().plan_type).toBe('free');
      expect(clientDouble.writtenAppSettings.length).toBe(0);
      expect(clientDouble.syncedTokens.length).toBe(0);
    });

    it('Scénario 6 — Utilisateur sans perm_config_license : pas de recherche automatique', async () => {
      const clientDouble = createClientSupabaseDouble({
        appSettingsRows: [],
        licenseConfigRows: [],
        session: {
          access_token: accessToken,
          user: { id: 'user-magasinier-2', email: 'magasinier@client.fr' },
        },
        userRow: { role_id: 2 }, // Rôle non-admin
        roleRow: { permissions: ['perm_menu_order_prep', 'perm_print_labels'] }, // Sans perm_config_license
      });

      const recovered = await recoverCompanyLicenseFromServerAndClientDb(
        projectUrl,
        clientDouble
      );

      expect(recovered).toBeNull();
      expect(invokeSpy).not.toHaveBeenCalled();
      expect(getSavedLicense().plan_type).toBe('free');
    });
  });
});

