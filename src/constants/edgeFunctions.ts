import { TABLES } from './tables';

/**
 * Nomenclature officielle des Edge Functions déployées dans le projet Supabase client (LOT 1 v43).
 */
export const EDGE_FUNCTIONS = {
  adminUsers: 'APP_TOT-Stock_admin-users',
  syncLicense: 'APP_TOT-Stock_licenses_sync-license',
  sendReportEmail: 'APP_TOT-Stock_send-report-email',
} as const;

/**
 * Nomenclature officielle des Edge Functions déployées sur la base maître Éditeur.
 */
export const MASTER_EDGE_FUNCTIONS = {
  licenses: 'APP_TOT-Stock_licenses',
} as const;

export type ClientEdgeFunctionKey = keyof typeof EDGE_FUNCTIONS;
export type ClientEdgeFunctionName = (typeof EDGE_FUNCTIONS)[ClientEdgeFunctionKey];

export type MasterEdgeFunctionKey = keyof typeof MASTER_EDGE_FUNCTIONS;
export type MasterEdgeFunctionName = (typeof MASTER_EDGE_FUNCTIONS)[MasterEdgeFunctionKey];

/**
 * Clés de surcharge possibles dans `public.core_app_settings` pour les installations
 * qui nomment leurs fonctions Edge autrement.
 */
export const EDGE_FUNCTION_OVERRIDE_SETTING_KEYS: Record<ClientEdgeFunctionKey, string> = {
  adminUsers: 'edge_fn_admin_users',
  syncLicense: 'edge_fn_sync_license',
  sendReportEmail: 'edge_fn_send_report_email',
} as const;

export const MASTER_EDGE_FUNCTION_OVERRIDE_SETTING_KEYS: Record<MasterEdgeFunctionKey, string> = {
  licenses: 'master_license_function',
} as const;

/**
 * Anciens noms courts (conservés uniquement ici pour référence / détection dans les tests).
 */
export const LEGACY_CLIENT_EDGE_FUNCTION_NAMES: Record<ClientEdgeFunctionKey, string> = {
  adminUsers: 'admin-users',
  syncLicense: 'sync-license',
  sendReportEmail: 'send-report-email',
} as const;

export const ALL_EDGE_FUNCTION_LITERALS = [
  EDGE_FUNCTIONS.adminUsers,
  EDGE_FUNCTIONS.syncLicense,
  EDGE_FUNCTIONS.sendReportEmail,
  MASTER_EDGE_FUNCTIONS.licenses,
  LEGACY_CLIENT_EDGE_FUNCTION_NAMES.adminUsers,
  LEGACY_CLIENT_EDGE_FUNCTION_NAMES.syncLicense,
  LEGACY_CLIENT_EDGE_FUNCTION_NAMES.sendReportEmail,
] as const;

// Cache mémoire des éventuelles surcharges lues depuis core_app_settings
const runtimeEdgeFunctionOverrides: Partial<
  Record<ClientEdgeFunctionKey | MasterEdgeFunctionKey, string>
> = {};

export function setEdgeFunctionOverrides(
  overrides: Partial<Record<ClientEdgeFunctionKey | MasterEdgeFunctionKey, string>>
): void {
  for (const [k, v] of Object.entries(overrides)) {
    const clean = typeof v === 'string' ? v.trim() : '';
    if (clean) {
      runtimeEdgeFunctionOverrides[k as ClientEdgeFunctionKey | MasterEdgeFunctionKey] = clean;
    } else {
      delete runtimeEdgeFunctionOverrides[k as ClientEdgeFunctionKey | MasterEdgeFunctionKey];
    }
  }
}

export function clearEdgeFunctionOverrides(): void {
  for (const key of Object.keys(runtimeEdgeFunctionOverrides)) {
    delete runtimeEdgeFunctionOverrides[key as ClientEdgeFunctionKey | MasterEdgeFunctionKey];
  }
}

/**
 * Résout le nom d'une Edge Function cliente en tenant compte d'une éventuelle surcharge
 * dans `core_app_settings` (`edge_fn_admin_users`, `edge_fn_sync_license`, `edge_fn_send_report_email`).
 */
export function getResolvedEdgeFunctionName(
  key: ClientEdgeFunctionKey,
  settingsMap?: Record<string, string | undefined>
): string {
  const settingKey = EDGE_FUNCTION_OVERRIDE_SETTING_KEYS[key];
  const fromMap = settingsMap?.[settingKey]?.trim();
  if (fromMap) return fromMap;

  const fromCache = runtimeEdgeFunctionOverrides[key]?.trim();
  if (fromCache) return fromCache;

  return EDGE_FUNCTIONS[key];
}

/**
 * Résout le nom d'une Edge Function maître en tenant compte d'une éventuelle surcharge
 * dans `core_app_settings` (`master_license_function` ou `edge_fn_master_licenses`).
 */
export function getResolvedMasterEdgeFunctionName(
  key: MasterEdgeFunctionKey = 'licenses',
  settingsMap?: Record<string, string | undefined>
): string {
  const settingKey = MASTER_EDGE_FUNCTION_OVERRIDE_SETTING_KEYS[key];
  const fromMap =
    settingsMap?.[settingKey]?.trim() || settingsMap?.['edge_fn_master_licenses']?.trim();
  if (fromMap) return fromMap;

  const fromCache = runtimeEdgeFunctionOverrides[key]?.trim();
  if (fromCache) return fromCache;

  return MASTER_EDGE_FUNCTIONS[key];
}

/**
 * Charge depuis `public.core_app_settings` les éventuelles surcharges de noms de fonctions Edge.
 */
export async function loadEdgeFunctionOverridesFromClientDb(
  client: any
): Promise<Record<string, string>> {
  const loaded: Record<string, string> = {};
  if (!client || typeof client.from !== 'function') return loaded;

  try {
    const keysToQuery = [
      EDGE_FUNCTION_OVERRIDE_SETTING_KEYS.adminUsers,
      EDGE_FUNCTION_OVERRIDE_SETTING_KEYS.syncLicense,
      EDGE_FUNCTION_OVERRIDE_SETTING_KEYS.sendReportEmail,
      MASTER_EDGE_FUNCTION_OVERRIDE_SETTING_KEYS.licenses,
      'edge_fn_master_licenses',
    ];
    const { data } = await client
      .from(TABLES.appSettings)
      .select('key, value')
      .in('key', keysToQuery);

    if (Array.isArray(data)) {
      for (const row of data) {
        const k = String(row?.key || '').trim();
        const v = String(row?.value || '').trim();
        if (!k || !v) continue;
        loaded[k] = v;
        if (k === EDGE_FUNCTION_OVERRIDE_SETTING_KEYS.adminUsers) {
          runtimeEdgeFunctionOverrides.adminUsers = v;
        } else if (k === EDGE_FUNCTION_OVERRIDE_SETTING_KEYS.syncLicense) {
          runtimeEdgeFunctionOverrides.syncLicense = v;
        } else if (k === EDGE_FUNCTION_OVERRIDE_SETTING_KEYS.sendReportEmail) {
          runtimeEdgeFunctionOverrides.sendReportEmail = v;
        } else if (
          k === MASTER_EDGE_FUNCTION_OVERRIDE_SETTING_KEYS.licenses ||
          k === 'edge_fn_master_licenses'
        ) {
          runtimeEdgeFunctionOverrides.licenses = v;
        }
      }
    }
  } catch {
    // Ignorer si la table core_app_settings n'est pas encore lisible
  }

  return loaded;
}

export type EdgeFunctionDeploymentState = 'deployed' | 'not_found' | 'error';

export interface EdgeFunctionPingItemResult {
  key: ClientEdgeFunctionKey;
  functionName: string;
  ok: boolean;
  state: EdgeFunctionDeploymentState;
  httpStatus?: number;
  detail: string;
  errorMessage?: string;
}

export interface EdgeFunctionsPingSummary {
  allOk: boolean;
  items: EdgeFunctionPingItemResult[];
  status: 'OK' | 'ATTENTION' | 'ERREUR';
  details: string;
  summary: string;
}

/**
 * Extrait le code HTTP et le message réel d'une erreur `FunctionsHttpError` / `FunctionsFetchError`.
 */
export async function extractEdgeFunctionErrorDetails(err: any, data?: any): Promise<{
  status: number;
  code: string;
  message: string;
  isNotFound: boolean;
}> {
  let body: any = data || null;
  const status = Number(err?.context?.status || err?.status || data?.status || 0);

  if (!body && err?.context) {
    try {
      const ctx =
        typeof err.context.clone === 'function' ? err.context.clone() : err.context;
      if (typeof ctx.json === 'function') {
        body = await ctx.json();
      } else if (typeof ctx.text === 'function') {
        const txt = await ctx.text();
        try {
          body = JSON.parse(txt);
        } catch {
          body = { message: txt };
        }
      }
    } catch {
      // ignore body parse errors
    }
  }

  const code = String(body?.code || err?.code || '').toUpperCase();
  const message = String(
    body?.error || body?.message || err?.message || ''
  ).trim();

  const lowerMsg = message.toLowerCase();
  const isNotFound =
    status === 404 ||
    code === 'NOT_FOUND' ||
    lowerMsg.includes('requested function was not found') ||
    lowerMsg.includes('function not found') ||
    lowerMsg.includes('introuvable');

  return {
    status,
    code,
    message,
    isNotFound,
  };
}

export function formatEdgeFunctionNotFoundDetail(fnName: string): string {
  return `${fnName} : introuvable : vérifiez le nom exact — introuvable : créez-la avec le nom exact : ${fnName} (onglet 4. Fonctions Edge)`;
}

/**
 * Appelle une fonction Edge cliente avec `{ action: 'ping' }` et renvoie son état précis.
 */
export async function pingSingleClientEdgeFunction(
  client: any,
  key: ClientEdgeFunctionKey
): Promise<EdgeFunctionPingItemResult> {
  const fnName = getResolvedEdgeFunctionName(key);
  if (!client || typeof client.functions?.invoke !== 'function') {
    return {
      key,
      functionName: fnName,
      ok: false,
      state: 'not_found',
      httpStatus: 404,
      detail: formatEdgeFunctionNotFoundDetail(fnName),
    };
  }

  try {
    const { data, error } = await client.functions.invoke(fnName, {
      body: { action: 'ping' },
    });

    if (!error && data && (data.success === true || data.status === 'ok' || data.status || data.ok === true)) {
      return {
        key,
        functionName: fnName,
        ok: true,
        state: 'deployed',
        httpStatus: 200,
        detail: `${fnName} : OK`,
      };
    }

    const parsed = await extractEdgeFunctionErrorDetails(error, data);
    if (
      parsed.isNotFound ||
      (!error?.context?.status && (error as any)?.name === 'FunctionsFetchError')
    ) {
      return {
        key,
        functionName: fnName,
        ok: false,
        state: 'not_found',
        httpStatus: parsed.status || 404,
        detail: formatEdgeFunctionNotFoundDetail(fnName),
      };
    }

    if (parsed.status === 401 || parsed.status === 403) {
      // La fonction a répondu (déployée sous le bon nom), même si le rôle appelant n'a pas la permission métier
      return {
        key,
        functionName: fnName,
        ok: true,
        state: 'deployed',
        httpStatus: parsed.status,
        detail: `${fnName} : OK`,
      };
    }

    return {
      key,
      functionName: fnName,
      ok: false,
      state: 'error',
      httpStatus: parsed.status || 500,
      errorMessage: parsed.message || 'Erreur lors de la sonde ping',
      detail: `${fnName} : ${parsed.message || formatEdgeFunctionNotFoundDetail(fnName)}`,
    };
  } catch {
    return {
      key,
      functionName: fnName,
      ok: false,
      state: 'not_found',
      httpStatus: 404,
      detail: formatEdgeFunctionNotFoundDetail(fnName),
    };
  }
}

/**
 * Appelle chacune des 3 fonctions Edge clientes avec `{ action: 'ping' }` pour le Diagnostic.
 */
export async function pingClientEdgeFunctions(
  client: any
): Promise<EdgeFunctionsPingSummary> {
  await loadEdgeFunctionOverridesFromClientDb(client);

  const keys: ClientEdgeFunctionKey[] = ['adminUsers', 'syncLicense', 'sendReportEmail'];
  const items: EdgeFunctionPingItemResult[] = [];

  for (const key of keys) {
    const item = await pingSingleClientEdgeFunction(client, key);
    items.push(item);
  }

  const allOk = items.every((i) => i.ok);
  const details = items.map((i) => i.detail).join(' | ');
  return {
    allOk,
    items,
    status: allOk ? 'OK' : 'ERREUR',
    details,
    summary: details,
  };
}

