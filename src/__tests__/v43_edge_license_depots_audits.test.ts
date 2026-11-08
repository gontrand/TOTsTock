import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  EDGE_FUNCTIONS,
  MASTER_EDGE_FUNCTIONS,
  getResolvedEdgeFunctionName,
  getResolvedMasterEdgeFunctionName,
  clearEdgeFunctionOverrides,
  loadEdgeFunctionOverridesFromClientDb,
  pingClientEdgeFunctions,
} from '../constants/edgeFunctions';
import {
  syncLicenseToClientDatabase,
  readClientDatabaseLicenseStatus,
  discoverLicenseByProjectUrl,
} from '../services/licenseService';
import {
  executeSaveDepotWithRollback,
  mergeDepotsPreservingInFlight,
  isDepotMutationInFlight,
  clearAllInFlightDepotMutations,
} from '../services/depotMutationService';
import {
  fetchInventoryAuditsFromSupabase,
  recordInventoryAuditToSupabase,
  retryQueuedInventoryAudit,
  discardQueuedInventoryAudit,
  AUDIT_HISTORY_NOT_SAVED_WARNING,
} from '../services/clientSupabase';
import { getQueuedInventoryAudits } from '../services/offline/indexedDb';
import { Depot, LicenseInfo, SignedLicenseToken } from '../types';

function walkFiles(dir: string, exts: string[], out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === '.git' ||
      entry.name === '__tests__'
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, exts, out);
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

describe('v43 — LOT 1 : Noms des fonctions Edge centralisés et sonde de diagnostic', () => {
  beforeEach(() => {
    clearEdgeFunctionOverrides();
  });

  it('définit les constantes exactes EDGE_FUNCTIONS et MASTER_EDGE_FUNCTIONS', () => {
    expect(EDGE_FUNCTIONS).toEqual({
      adminUsers: 'APP_TOT-Stock_admin-users',
      syncLicense: 'APP_TOT-Stock_licenses_sync-license',
      sendReportEmail: 'APP_TOT-Stock_send-report-email',
      passwordReset: 'APP_TOT-Stock_password-reset',
    });
    expect(MASTER_EDGE_FUNCTIONS).toEqual({
      licenses: 'APP_TOT-Stock_licenses',
    });
  });

  it('échoue si un nom de fonction Edge est en dur dans functions.invoke(...) ou /functions/v1/... hors de edgeFunctions.ts', () => {
    const srcDir = path.resolve(process.cwd(), 'src');
    const files = walkFiles(srcDir, ['.ts', '.tsx']);
    const allowedFile = path.resolve(srcDir, 'constants', 'edgeFunctions.ts');

    const offenders: string[] = [];
    const invokeLiteralRegex = /\.functions\.invoke\(\s*['"`]([^'"`]+)['"`]/g;
    const urlLiteralRegex =
      /\/functions\/v1\/(?:APP_TOT-Stock_[a-zA-Z0-9_-]+|admin-users|sync-license|send-report-email|tot-licenses)/g;

    for (const file of files) {
      if (path.resolve(file) === allowedFile) continue;
      const content = fs.readFileSync(file, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = invokeLiteralRegex.exec(content)) !== null) {
        offenders.push(`${path.relative(process.cwd(), file)}: functions.invoke('${m[1]}')`);
      }
      while ((m = urlLiteralRegex.exec(content)) !== null) {
        offenders.push(`${path.relative(process.cwd(), file)}: ${m[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('vérifie que les dossiers de déploiement supabase/functions correspondent aux noms exacts', () => {
    for (const fnName of Object.values(EDGE_FUNCTIONS)) {
      const supaPath = path.resolve(process.cwd(), 'supabase', 'functions', fnName, 'index.ts');
      const clientPath = path.resolve(
        process.cwd(),
        'supabase-client',
        'functions',
        fnName,
        'index.ts'
      );
      expect(fs.existsSync(supaPath)).toBe(true);
      if (fnName !== 'APP_TOT-Stock_password-reset') {
        expect(fs.existsSync(clientPath)).toBe(true);
      }
    }
  });

  it('permet de surcharger les noms de fonctions Edge via core_app_settings', async () => {
    const fakeClient: any = {
      from: () => ({
        select: () => ({
          in: async () => ({
            data: [
              { key: 'edge_fn_sync_license', value: 'custom-sync-license' },
              { key: 'master_license_function', value: 'custom-master-licenses' },
            ],
            error: null,
          }),
        }),
      }),
    };

    await loadEdgeFunctionOverridesFromClientDb(fakeClient);
    expect(getResolvedEdgeFunctionName('syncLicense')).toBe('custom-sync-license');
    expect(getResolvedEdgeFunctionName('adminUsers')).toBe(EDGE_FUNCTIONS.adminUsers);
    expect(getResolvedMasterEdgeFunctionName()).toBe('custom-master-licenses');
  });

  it('sonde chaque fonction Edge avec {action:"ping"} et distingue "introuvable : vérifiez le nom exact" et "OK"', async () => {
    const fakeClientNotFound: any = {
      functions: {
        invoke: async (fnName: string, opts: any) => {
          expect(opts?.body).toEqual({ action: 'ping' });
          if (fnName === EDGE_FUNCTIONS.syncLicense) {
            return {
              data: null,
              error: { message: 'Requested function was not found', context: { status: 404 } },
            };
          }
          return { data: { ok: true, status: 'ok' }, error: null };
        },
      },
    };

    const reportErr = await pingClientEdgeFunctions(fakeClientNotFound);
    expect(reportErr.allOk).toBe(false);
    expect(reportErr.status).toBe('ERREUR');
    expect(reportErr.details).toContain(
      `${EDGE_FUNCTIONS.syncLicense} : introuvable : vérifiez le nom exact`
    );
    expect(reportErr.details).toContain(`${EDGE_FUNCTIONS.adminUsers} : OK`);

    const fakeClientAllOk: any = {
      functions: {
        invoke: async () => ({ data: { ok: true, status: 'ok' }, error: null }),
      },
    };
    const reportOk = await pingClientEdgeFunctions(fakeClientAllOk);
    expect(reportOk.allOk).toBe(true);
    expect(reportOk.status).toBe('OK');
  });
});

describe('v43 — LOT 2 : Synchronisation de licence honnête et découverte claire', () => {
  beforeEach(() => {
    clearEdgeFunctionOverrides();
  });

  const sampleSignedToken: SignedLicenseToken = {
    kid: 'ed25519-v1-2026-04',
    token_version: 1,
    license_key: 'TOT-PRO-2026-TEST',
    organization_name: 'TOT Test',
    client_supabase_url: 'https://client.supabase.co',
    plan: 'pro',
    modules: ['stock'],
    max_depots: 10,
    expires_at: null,
    issued_at: '2026-01-01T00:00:00.000Z',
    offline_until: '2026-01-16T00:00:00.000Z',
    signature: 'ed25519_test_signature_valid_length_0123456789abcdef',
    raw_token: 'tot-v1.eyJ0ZXN0IjoidHJ1ZSJ9.ed25519_test_signature_valid_length_0123456789abcdef',
  };

  const sampleProLicense: LicenseInfo = {
    license_key: 'TOT-PRO-2026-TEST',
    organization_name: 'TOT Test',
    client_supabase_url: 'https://client.supabase.co',
    plan: 'pro',
    plan_type: 'pro',
    modules: ['stock'],
    max_depots: 10,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    expires_at: null,
    last_verified_at: '2026-01-01T00:00:00.000Z',
    status: 'valid',
    signed_token: sampleSignedToken,
  };

  function makeFakeDbClient(
    invokeImpl: (fnName: string, opts: any) => Promise<any>,
    licenseConfigRow: Record<string, any> | null
  ) {
    return {
      functions: {
        invoke: invokeImpl,
      },
      from: (table: string) => ({
        select: () => ({
          in: async () => ({ data: [], error: null }),
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
          limit: async () => ({
            data: licenseConfigRow && table === 'core_license_config' ? [licenseConfigRow] : [],
            error: null,
          }),
        }),
        upsert: async () => ({ error: null }),
      }),
    };
  }

  it('renvoie success:false avec message explicite quand la fonction sync-license est introuvable (404)', async () => {
    const fakeClient: any = makeFakeDbClient(
      async () => ({
        data: null,
        error: {
          message: 'Requested function was not found',
          context: { status: 404 },
        },
      }),
      { id: 'active_license', plan_type: 'free', max_depots: 1, signed_token: null }
    );

    const res = await syncLicenseToClientDatabase(sampleProLicense, fakeClient);
    expect(res.success).toBe(false);
    expect(res.status).toBe(404);
    expect(res.isNotFound).toBe(true);
    expect(res.message).toContain('introuvable (404) : vérifiez le nom exact');
    expect(res.dbStatus?.mismatchWithApp).toBe(true);
    expect(res.dbStatus?.effectivePlan).toBe('free');
    expect(res.dbStatus?.effectiveMaxDepots).toBe(1);
    expect(res.dbStatus?.hasSignedToken).toBe(false);
  });

  it('renvoie success:false avec le message réel de la fonction sur 403 (signature/permission/projet)', async () => {
    const fakeClient: any = makeFakeDbClient(
      async () => ({
        data: { error: 'Signature cryptographique Ed25519 invalide ou projet non autorisé.' },
        error: {
          message: 'Edge Function returned a non-2xx status code',
          context: { status: 403 },
        },
      }),
      { id: 'active_license', plan_type: 'free', max_depots: 1, signed_token: null }
    );

    const res = await syncLicenseToClientDatabase(sampleProLicense, fakeClient);
    expect(res.success).toBe(false);
    expect(res.status).toBe(403);
    expect(res.message).toContain('Refusé par');
    expect(res.message).toContain('Signature cryptographique Ed25519 invalide');
  });

  it('renvoie success:false avec le message réel de la fonction sur 500 (erreur écriture)', async () => {
    const fakeClient: any = makeFakeDbClient(
      async () => ({
        data: { error: 'Échec écriture core_license_config: permission denied' },
        error: {
          message: 'Internal Server Error',
          context: { status: 500 },
        },
      }),
      { id: 'active_license', plan_type: 'free', max_depots: 1, signed_token: null }
    );

    const res = await syncLicenseToClientDatabase(sampleProLicense, fakeClient);
    expect(res.success).toBe(false);
    expect(res.status).toBe(500);
    expect(res.message).toContain("Erreur d'écriture APP_TOT-Stock_licenses_sync-license (500)");
    expect(res.message).toContain('Échec écriture core_license_config');
  });

  it('relit core_license_config après un succès : renvoie success:true si le jeton signé est présent en base', async () => {
    const fakeClient: any = makeFakeDbClient(
      async () => ({
        data: { success: true },
        error: null,
      }),
      {
        id: 'active_license',
        plan_type: 'pro',
        max_depots: 10,
        signed_token: sampleSignedToken,
      }
    );

    const res = await syncLicenseToClientDatabase(sampleProLicense, fakeClient);
    expect(res.success).toBe(true);
    expect(res.dbStatus?.effectivePlan).toBe('pro');
    expect(res.dbStatus?.effectiveMaxDepots).toBe(10);
    expect(res.dbStatus?.hasSignedToken).toBe(true);
    expect(res.dbStatus?.mismatchWithApp).toBe(false);
  });

  it('détecte le désalignement (mismatchWithApp: true) si l’application affiche PRO alors que la base est en FREE sans jeton signé', async () => {
    const fakeClient: any = makeFakeDbClient(
      async () => ({ data: null, error: null }),
      {
        id: 'active_license',
        plan_type: 'free',
        max_depots: 1,
        signed_token: null,
      }
    );

    const status = await readClientDatabaseLicenseStatus(fakeClient, 'pro');
    expect(status.effectivePlan).toBe('free');
    expect(status.effectiveMaxDepots).toBe(1);
    expect(status.hasSignedToken).toBe(false);
    expect(status.mismatchWithApp).toBe(true);
  });

  it('distingue "fonction introuvable" (404), "refusé" (403) et "licence non liée" lors de la découverte', async () => {
    const res404 = await discoverLicenseByProjectUrl(
      'https://client.supabase.co',
      'anon-key',
      'access-token',
      {
        force: true,
        invokeFn: async () => ({
          data: null,
          error: { message: 'Requested function was not found', context: { status: 404 } },
        }),
      }
    );
    expect(res404.status).toBe('function_not_found');
    expect(res404.message).toContain('Fonction introuvable (404)');

    const res403 = await discoverLicenseByProjectUrl(
      'https://client.supabase.co',
      'anon-key',
      'access-token',
      {
        force: true,
        invokeFn: async () => ({
          data: { code: 'DISCOVER_DENIED', message: 'Refusé : session invalide' },
          error: { message: 'Forbidden', context: { status: 403 } },
        }),
      }
    );
    expect(res403.status).toBe('denied');
    expect(res403.message).toContain('Refusé');

    const resNotLinked = await discoverLicenseByProjectUrl(
      'https://client.supabase.co',
      'anon-key',
      'access-token',
      {
        force: true,
        invokeFn: async () => ({
          data: {
            code: 'LICENSE_NOT_FOUND',
            message: 'Licence non liée : aucune licence active pour ce projet.',
          },
          error: { message: 'Not Found', context: { status: 404 } },
        }),
      }
    );
    expect(resNotLinked.status).toBe('not_found');
    expect(resNotLinked.message).toContain('Licence non liée');
  });
});

describe('v43 — LOT 3 : Réactivation d’un dépôt refusée par le serveur (rollback + protection sync)', () => {
  beforeEach(() => {
    clearAllInFlightDepotMutations();
  });

  const existingDepots: Depot[] = [
    {
      id: 'dep-1',
      name: 'Dépôt Principal',
      type: 'FIXED',
      is_active: true,
    },
    {
      id: 'dep-2',
      name: 'Dépôt Secondaire',
      type: 'FIXED',
      is_active: false,
    },
  ];

  it('restaure l’état précédent et renvoie "Refusé par le serveur : <message>" quand le serveur refuse la réactivation (quota ou autre)', async () => {
    let stateDepots: Depot[] = [...existingDepots];
    const snapshots: Depot[][] = [];

    const res = await executeSaveDepotWithRollback({
      depots: stateDepots,
      depotData: {
        ...existingDepots[1],
        is_active: true,
      },
      maxDepots: 10,
      client: {} as any,
      onSetDepots: (updater) => {
        stateDepots = updater(stateDepots);
        snapshots.push(stateDepots);
      },
      upsertFn: async () => ({
        success: false,
        error:
          'QUOTA_EXCEEDED: Votre licence TOT Stock (FREE) est limitée à 1 magasin(s)/dépôt(s) actif(s) maximum.',
      }),
    });

    expect(res.success).toBe(false);
    expect(res.rolledBack).toBe(true);
    expect(res.message).toContain('Refusé par le serveur :');
    expect(res.message).toContain('QUOTA_EXCEEDED');

    // 1er snapshot : mise à jour optimiste (is_active: true)
    expect(snapshots[0].find((d) => d.id === 'dep-2')?.is_active).toBe(true);
    // Dernier snapshot : rollback à l'état précédent (is_active: false)
    const finalDepots = snapshots[snapshots.length - 1];
    expect(finalDepots.find((d) => d.id === 'dep-2')?.is_active).toBe(false);
  });

  it('empêche le rafraîchissement automatique (syncFromSupabase) d’écraser un dépôt en cours de modification, et conserve l’état serveur en cas de succès', async () => {
    let stateDepots: Depot[] = [...existingDepots];
    let inFlightMerged: Depot[] = [];

    const res = await executeSaveDepotWithRollback({
      depots: stateDepots,
      depotData: {
        ...existingDepots[1],
        is_active: true,
      },
      maxDepots: 10,
      client: {} as any,
      onSetDepots: (updater) => {
        stateDepots = updater(stateDepots);
      },
      upsertFn: async (_client, depotBeingSaved) => {
        expect(isDepotMutationInFlight({ id: 'dep-2', name: 'Dépôt Secondaire' })).toBe(true);
        // Simuler un syncFromSupabase concurrent qui renvoie encore l'ancien état serveur (is_active: false)
        const remoteStaleDepots: Depot[] = [
          { id: 'dep-1', name: 'Dépôt Principal', type: 'FIXED', is_active: true },
          { id: 'dep-2', name: 'Dépôt Secondaire', type: 'FIXED', is_active: false },
        ];
        inFlightMerged = mergeDepotsPreservingInFlight(stateDepots, remoteStaleDepots);
        return {
          success: true,
          table: 'stk_depots',
          inserted: { ...depotBeingSaved, is_active: true },
        };
      },
    });

    expect(res.success).toBe(true);
    // Pendant la mutation en cours, syncFromSupabase n'a pas écrasé dep-2
    expect(inFlightMerged.find((d) => d.id === 'dep-2')?.is_active).toBe(true);
    // Après la fin de la mutation, le verrou est relâché
    expect(isDepotMutationInFlight({ id: 'dep-2', name: 'Dépôt Secondaire' })).toBe(false);
    expect(stateDepots.find((d) => d.id === 'dep-2')?.is_active).toBe(true);
  });
});

describe('v43 — LOT 4 : Historique des audits (erreur de lecture visible, file d’attente hors ligne / échec)', () => {
  it('retourne success:false et le message d’erreur quand la lecture de stk_inventory_audits est refusée', async () => {
    const fakeDeniedClient: any = {
      from: () => ({
        select: () => ({
          order: () => ({
            limit: async () => ({
              data: null,
              error: {
                code: '42501',
                message: 'permission denied for table stk_inventory_audits',
              },
            }),
          }),
        }),
      }),
    };

    const res = await fetchInventoryAuditsFromSupabase(fakeDeniedClient);
    expect(res.success).toBe(false);
    expect(res.audits).toEqual([]);
    expect(res.error).toContain('permission denied for table stk_inventory_audits');
  });

  it('met en file d’attente (sync_queue) l’écriture de l’historique d’audit en cas d’échec ou hors ligne et renvoie l’avertissement explicite', async () => {
    // Nettoyer d'abord les éventuelles opérations en attente
    const existing = await getQueuedInventoryAudits();
    for (const op of existing) {
      await discardQueuedInventoryAudit(String(op.id));
    }

    // 1. Écriture hors ligne (client = null) -> mise en file d'attente + avertissement
    const offlineRes = await recordInventoryAuditToSupabase(null, {
      id: 'AUD-OFFLINE-TEST-1',
      depot_name: 'Dépôt Principal',
      auditor_id: 'u-1',
      auditor_name: 'Jean Test',
      items_counted: 2,
      items_with_diff: 1,
      total_diff_cost: -15,
      audit_notes: 'Audit test hors ligne',
      items: [
        {
          product_id: 'p-1',
          product_ref: 'REF-001',
          product_name: 'Disjoncteur',
          theoretical_qty: 5,
          physical_count: 4,
          difference: -1,
          unit_price: 15,
          diff_cost: -15,
        },
      ],
    });

    expect(offlineRes.success).toBe(false);
    expect(offlineRes.queued).toBe(true);
    expect(offlineRes.warningMessage).toBe(AUDIT_HISTORY_NOT_SAVED_WARNING);
    expect(offlineRes.warningMessage).toBe(
      "Stock régularisé, mais l'historique n'a pas pu être enregistré"
    );

    const queuedAfterOffline = await getQueuedInventoryAudits();
    expect(queuedAfterOffline.some((op) => op.id === offlineRes.operationId)).toBe(true);

    // 2. Réessayer avec un client Supabase valide -> succès et retrait de la file d'attente
    const insertedTables: string[] = [];
    const fakeSuccessClient: any = {
      from: (table: string) => ({
        insert: async () => {
          insertedTables.push(table);
          return { error: null };
        },
      }),
    };

    const retryRes = await retryQueuedInventoryAudit(
      fakeSuccessClient,
      String(offlineRes.operationId)
    );
    expect(retryRes.success).toBe(true);
    expect(insertedTables).toEqual(['stk_inventory_audits', 'stk_inventory_audit_items']);

    const queuedAfterRetry = await getQueuedInventoryAudits();
    expect(queuedAfterRetry.some((op) => op.id === offlineRes.operationId)).toBe(false);
  });
});
