import type { SupabaseClient } from '@supabase/supabase-js';
import { getClientSupabase } from './clientSupabase';
import type { Language } from '../i18n/translations';
import { tr } from '../i18n/dutchTranslator';

export type AuditLogCategory =
  | 'USERS'
  | 'CONFIG'
  | 'CATALOG'
  | 'DEPOTS'
  | 'ORDERS'
  | 'MOVEMENTS'
  | 'SECURITY'
  | 'EXPORTS'
  | 'SYSTEM';

export type AuditLogSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export type LoginLogAction =
  | 'LOGIN_SUCCESS'
  | 'LOGOUT'
  | 'LOGIN_FAILED'
  | 'SESSION_RESTORED';

export type AuditPeriodPreset = '7d' | '30d' | 'custom' | 'all';

export interface AuditLogSearchFilters {
  period?: AuditPeriodPreset;
  dateFrom?: string;
  dateTo?: string;
  category?: string;
  user?: string;
  type?: string;
  severity?: string;
  text?: string;
  limit?: number;
  offset?: number;
}

export interface LoginLogSearchFilters {
  period?: AuditPeriodPreset;
  dateFrom?: string;
  dateTo?: string;
  user?: string;
  action?: string;
  text?: string;
  limit?: number;
  offset?: number;
}

export interface ServerAuditLogRow {
  id: string;
  app: string;
  created_at: string;
  user_id?: string | null;
  user_name: string;
  user_trigram?: string | null;
  type: string;
  action: string;
  category: AuditLogCategory | string;
  severity: AuditLogSeverity | string;
  title: string;
  description: string;
  ip_address?: string | null;
  table_name?: string | null;
  record_id?: string | null;
  product_id?: string | null;
  product_ref?: string | null;
  quantity_changed?: number | null;
  site_number?: string | null;
  depot_name?: string | null;
  meta: Record<string, any>;
}

export interface ServerLoginLogRow {
  id: string;
  app: string;
  created_at: string;
  user_id?: string | null;
  user_name: string;
  user_trigram?: string | null;
  identifier: string;
  action: LoginLogAction | string;
  reason?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  meta: Record<string, any>;
  failure_count_for_identifier?: number;
}

export interface AuditChangeDiffEntry {
  field: string;
  oldValue: string;
  newValue: string;
  isMasked: boolean;
}

export interface RepeatedLoginFailureSummary {
  identifier: string;
  count: number;
  lastAttemptAt: string;
  ipAddresses: string[];
  reasons: string[];
}

export interface PurgeAuditLogsResult {
  older_than_days: number;
  deleted_audit_logs: number;
  deleted_login_logs: number;
  total_deleted: number;
}

export const SESSION_RESTORED_THROTTLE_KEY = 'tot_stock_last_session_restored_log_v1';
export const SESSION_RESTORED_THROTTLE_MS = 60 * 60 * 1000; // 1 heure par appareil
export const AUDIT_CSV_MAX_ROWS = 5000;

const SENSITIVE_KEY_EXACT = new Set([
  'pin',
  'pin_hash',
  'password',
  'new_password',
  'old_password',
  'initial_password',
  'initialpassword',
  'encrypted_password',
  'secret',
  'secret_name',
  'smtp_pass',
  'brevo_api_key',
  'api_key',
  'apikey',
  'token',
  'signed_token',
  'access_token',
  'refresh_token',
  'client_secret',
  'private_key',
  'reset_token',
  'recovery_token',
  'confirmation_token',
  'signature_data',
  'proof_photo_url',
]);

const FORBIDDEN_EXPORT_CONTENT_KEYS = new Set([
  'rows_data',
  'csv_content',
  'pdf_content',
  'raw_rows',
  'exported_rows',
  'html_body',
]);

export function isSensitiveAuditKey(key: string): boolean {
  const k = String(key || '').trim().toLowerCase();
  if (!k) return false;
  if (SENSITIVE_KEY_EXACT.has(k)) return true;
  if (
    k.includes('password') ||
    k.includes('secret') ||
    k.includes('api_key') ||
    k.includes('apikey') ||
    k.includes('token') ||
    k.includes('pin')
  ) {
    return true;
  }
  return false;
}

/**
 * Nettoie récursivement un objet meta avant envoi au serveur :
 * - Remplace tout champ sensible (mot de passe, PIN, clé API, jeton) par '***'
 * - Supprime tout contenu métier volumineux d'export (rows_data, csv_content, etc.)
 */
export function sanitizeAuditMeta(
  meta: Record<string, any> | null | undefined
): Record<string, any> {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return {};
  }
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(meta)) {
    const lowerKey = key.toLowerCase().trim();
    if (FORBIDDEN_EXPORT_CONTENT_KEYS.has(lowerKey)) {
      continue;
    }
    if (isSensitiveAuditKey(key)) {
      out[key] = '***';
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      out[key] = sanitizeAuditMeta(val);
    } else if (Array.isArray(val)) {
      out[key] = val.slice(0, 50).map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? sanitizeAuditMeta(item)
          : item
      );
    } else {
      out[key] = val;
    }
  }
  return out;
}

export function computeAuditPeriodBounds(
  period: AuditPeriodPreset = '7d',
  dateFrom?: string,
  dateTo?: string,
  now: Date = new Date()
): { fromIso: string | null; toIso: string | null } {
  if (period === 'all') {
    return { fromIso: null, toIso: null };
  }
  if (period === '7d') {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { fromIso: start.toISOString(), toIso: null };
  }
  if (period === '30d') {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { fromIso: start.toISOString(), toIso: null };
  }
  let fromIso: string | null = null;
  let toIso: string | null = null;
  if (dateFrom && dateFrom.trim()) {
    const d = new Date(`${dateFrom.trim()}T00:00:00`);
    if (!Number.isNaN(d.getTime())) fromIso = d.toISOString();
  }
  if (dateTo && dateTo.trim()) {
    const d = new Date(`${dateTo.trim()}T23:59:59.999`);
    if (!Number.isNaN(d.getTime())) toIso = d.toISOString();
  }
  return { fromIso, toIso };
}

export function buildSearchAuditLogsRpcParams(
  filters: AuditLogSearchFilters,
  now: Date = new Date()
): Record<string, any> {
  const { fromIso, toIso } = computeAuditPeriodBounds(
    filters.period || '7d',
    filters.dateFrom,
    filters.dateTo,
    now
  );
  const norm = (v?: string) => {
    const t = String(v || '').trim();
    return !t || t.toUpperCase() === 'ALL' ? null : t;
  };
  return {
    p_from: fromIso,
    p_to: toIso,
    p_category: norm(filters.category),
    p_user: norm(filters.user),
    p_type: norm(filters.type),
    p_severity: norm(filters.severity),
    p_text: norm(filters.text),
    p_limit: Math.min(Math.max(Number(filters.limit) || 50, 1), AUDIT_CSV_MAX_ROWS),
    p_offset: Math.max(Number(filters.offset) || 0, 0),
  };
}

export function buildSearchLoginLogsRpcParams(
  filters: LoginLogSearchFilters,
  now: Date = new Date()
): Record<string, any> {
  const { fromIso, toIso } = computeAuditPeriodBounds(
    filters.period || '7d',
    filters.dateFrom,
    filters.dateTo,
    now
  );
  const norm = (v?: string) => {
    const t = String(v || '').trim();
    return !t || t.toUpperCase() === 'ALL' ? null : t;
  };
  return {
    p_from: fromIso,
    p_to: toIso,
    p_user: norm(filters.user),
    p_action: norm(filters.action),
    p_text: norm(filters.text),
    p_limit: Math.min(Math.max(Number(filters.limit) || 50, 1), AUDIT_CSV_MAX_ROWS),
    p_offset: Math.max(Number(filters.offset) || 0, 0),
  };
}

function stringifyAuditValue(val: any): string {
  if (val === '***') return '***';
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'string') return val === '' ? '""' : val;
  if (typeof val === 'number') return String(val);
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

/**
 * Formate l'objet `meta.changes` (ou `meta.snapshot`) en tableau lisible
 * « champ : ancienne valeur -> nouvelle valeur ». Les valeurs '***' restent '***'.
 */
export function formatAuditChangesDiff(
  meta: Record<string, any> | null | undefined
): AuditChangeDiffEntry[] {
  if (!meta || typeof meta !== 'object') return [];
  const changes = meta.changes;
  if (changes && typeof changes === 'object' && !Array.isArray(changes)) {
    const entries: AuditChangeDiffEntry[] = [];
    for (const [field, diffObj] of Object.entries(changes)) {
      const sensitive = isSensitiveAuditKey(field);
      if (sensitive) {
        entries.push({
          field,
          oldValue: '***',
          newValue: '***',
          isMasked: true,
        });
        continue;
      }
      if (diffObj && typeof diffObj === 'object' && ('old' in diffObj || 'new' in diffObj)) {
        const oldVal = (diffObj as any).old;
        const newVal = (diffObj as any).new;
        const isMasked = oldVal === '***' || newVal === '***';
        entries.push({
          field,
          oldValue: isMasked && oldVal === '***' ? '***' : stringifyAuditValue(oldVal),
          newValue: isMasked && newVal === '***' ? '***' : stringifyAuditValue(newVal),
          isMasked,
        });
      } else {
        entries.push({
          field,
          oldValue: '—',
          newValue: stringifyAuditValue(diffObj),
          isMasked: diffObj === '***',
        });
      }
    }
    return entries.sort((a, b) => a.field.localeCompare(b.field));
  }
  return [];
}

/**
 * Regroupe les échecs de connexion répétés (>= threshold, par défaut 5) pour un même identifiant sur la période.
 */
export function detectRepeatedLoginFailures(
  rows: ServerLoginLogRow[],
  threshold = 5
): RepeatedLoginFailureSummary[] {
  const byIdentifier = new Map<
    string,
    {
      displayIdentifier: string;
      count: number;
      lastAttemptAt: string;
      ips: Set<string>;
      reasons: Set<string>;
    }
  >();

  for (const row of rows) {
    if (String(row.action || '').toUpperCase() !== 'LOGIN_FAILED') continue;
    const rawId = String(row.identifier || row.user_name || 'unknown').trim() || 'unknown';
    const key = rawId.toLowerCase();
    const existing = byIdentifier.get(key);
    const createdAt = row.created_at || new Date(0).toISOString();
    if (!existing) {
      const ips = new Set<string>();
      if (row.ip_address) ips.add(row.ip_address);
      const reasons = new Set<string>();
      if (row.reason) reasons.add(row.reason);
      byIdentifier.set(key, {
        displayIdentifier: rawId,
        count: 1,
        lastAttemptAt: createdAt,
        ips,
        reasons,
      });
    } else {
      existing.count += 1;
      if (createdAt > existing.lastAttemptAt) {
        existing.lastAttemptAt = createdAt;
      }
      if (row.ip_address) existing.ips.add(row.ip_address);
      if (row.reason) existing.reasons.add(row.reason);
    }
  }

  const alerts: RepeatedLoginFailureSummary[] = [];
  for (const item of byIdentifier.values()) {
    if (item.count >= threshold) {
      alerts.push({
        identifier: item.displayIdentifier,
        count: item.count,
        lastAttemptAt: item.lastAttemptAt,
        ipAddresses: Array.from(item.ips),
        reasons: Array.from(item.reasons),
      });
    }
  }

  return alerts.sort((a, b) => b.count - a.count);
}

function escapeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  const clean = str.replace(/\r?\n/g, ' ').trim();
  if (clean.includes(';') || clean.includes('"')) {
    return `"${clean.replace(/"/g, '""')}"`;
  }
  return clean;
}

export function generateAuditLogsCsv(
  rows: ServerAuditLogRow[],
  language: Language = 'fr'
): string {
  const headers = [
    tr(language, 'Date / Heure', 'Date / Time', 'Datum / Tijd'),
    tr(language, 'Sévérité', 'Severity', 'Ernst'),
    tr(language, 'Catégorie', 'Category', 'Categorie'),
    tr(language, 'Type', 'Type', 'Type'),
    tr(language, 'Acteur', 'Actor', 'Actor'),
    tr(language, 'Trigramme', 'Trigram', 'Trigram'),
    tr(language, 'Titre', 'Title', 'Titel'),
    tr(language, 'Description', 'Description', 'Beschrijving'),
    tr(language, 'Table', 'Table', 'Tabel'),
    tr(language, 'ID Enregistrement', 'Record ID', 'Record-ID'),
    tr(language, 'Adresse IP', 'IP Address', 'IP-adres'),
  ];

  const capped = rows.slice(0, AUDIT_CSV_MAX_ROWS);
  const lines = [headers.map(escapeCsvCell).join(';')];
  for (const r of capped) {
    lines.push(
      [
        r.created_at,
        r.severity,
        r.category,
        r.type || r.action,
        r.user_name,
        r.user_trigram || '',
        r.title,
        r.description,
        r.table_name || r.meta?.table || '',
        r.record_id || r.meta?.record_id || '',
        r.ip_address || '',
      ]
        .map(escapeCsvCell)
        .join(';')
    );
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

export function generateLoginLogsCsv(
  rows: ServerLoginLogRow[],
  language: Language = 'fr'
): string {
  const headers = [
    tr(language, 'Date / Heure', 'Date / Time', 'Datum / Tijd'),
    tr(language, 'Action', 'Action', 'Actie'),
    tr(language, 'Identifiant', 'Identifier', 'Identificatie'),
    tr(language, 'Utilisateur', 'User', 'Gebruiker'),
    tr(language, 'Trigramme', 'Trigram', 'Trigram'),
    tr(language, 'Motif / Détail', 'Reason / Detail', 'Reden / Detail'),
    tr(language, 'Adresse IP', 'IP Address', 'IP-adres'),
    tr(language, 'Navigateur / Appareil', 'User Agent / Device', 'Browser / Apparaat'),
  ];

  const capped = rows.slice(0, AUDIT_CSV_MAX_ROWS);
  const lines = [headers.map(escapeCsvCell).join(';')];
  for (const r of capped) {
    lines.push(
      [
        r.created_at,
        r.action,
        r.identifier || r.user_name,
        r.user_name,
        r.user_trigram || '',
        r.reason || '',
        r.ip_address || '',
        r.user_agent || '',
      ]
        .map(escapeCsvCell)
        .join(';')
    );
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

/**
 * Appel fire-and-forget de `log_audit_event` côté serveur.
 * Ne bloque jamais l'interface et masque systématiquement tout secret.
 */
export async function logAuditEventServer(
  params: {
    category: AuditLogCategory;
    type: string;
    title: string;
    description?: string;
    severity?: AuditLogSeverity;
    meta?: Record<string, any>;
  },
  explicitClient?: SupabaseClient | null
): Promise<void> {
  try {
    const client = explicitClient ?? getClientSupabase();
    if (!client) return;
    const safeMeta = sanitizeAuditMeta(params.meta);
    await client.rpc('log_audit_event', {
      p_category: params.category,
      p_type: params.type,
      p_title: params.title,
      p_description: params.description ?? null,
      p_severity: params.severity ?? 'INFO',
      p_meta: safeMeta,
    });
  } catch {
    // Fire-and-forget : ne bloque jamais l'action métier
  }
}

let lastSessionRestoredMemoryTs = 0;

export function resetSessionRestoredThrottleForTests(): void {
  lastSessionRestoredMemoryTs = 0;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SESSION_RESTORED_THROTTLE_KEY);
    }
  } catch {
    // ignore
  }
}

/**
 * Appel fire-and-forget de `log_login_event` (LOGIN_SUCCESS, LOGOUT, SESSION_RESTORED).
 * Pour SESSION_RESTORED, limite à 1 appel par heure et par appareil.
 */
export async function logLoginEventServer(
  action: 'LOGIN_SUCCESS' | 'LOGOUT' | 'SESSION_RESTORED',
  meta?: Record<string, any>,
  explicitClient?: SupabaseClient | null
): Promise<void> {
  try {
    if (action === 'SESSION_RESTORED') {
      const now = Date.now();
      let lastTs = lastSessionRestoredMemoryTs;
      if (typeof localStorage !== 'undefined') {
        try {
          const lastRaw = localStorage.getItem(SESSION_RESTORED_THROTTLE_KEY);
          if (lastRaw) {
            const parsed = Number(lastRaw);
            if (Number.isFinite(parsed) && parsed > lastTs) {
              lastTs = parsed;
            }
          }
        } catch {
          // ignore
        }
      }
      if (lastTs > 0 && now - lastTs < SESSION_RESTORED_THROTTLE_MS) {
        return;
      }
      lastSessionRestoredMemoryTs = now;
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(SESSION_RESTORED_THROTTLE_KEY, String(now));
        } catch {
          // ignore
        }
      }
    }

    const client = explicitClient ?? getClientSupabase();
    if (!client) return;

    const safeMeta = sanitizeAuditMeta({
      ...meta,
      user_agent:
        typeof navigator !== 'undefined' ? navigator.userAgent?.slice(0, 250) : undefined,
    });

    await client.rpc('log_login_event', {
      p_action: action,
      p_meta: safeMeta,
    });
  } catch {
    // Fire-and-forget
  }
}

/**
 * Appel fire-and-forget de `log_login_failure` (autorisé sans session).
 * Ne transmet JAMAIS le mot de passe ni le code PIN.
 */
export async function logLoginFailureServer(
  identifier: string,
  reason = 'INVALID_CREDENTIALS',
  meta?: Record<string, any>,
  explicitClient?: SupabaseClient | null
): Promise<void> {
  try {
    const client = explicitClient ?? getClientSupabase();
    if (!client) return;

    const trimmed = String(identifier || '').trim().slice(0, 160);
    // Ne jamais envoyer de code PIN numérique brut comme identifiant
    const safeIdentifier =
      !trimmed ? 'unknown' : /^[0-9]{4,8}$/.test(trimmed) ? '[PIN]' : trimmed;

    const safeMeta = sanitizeAuditMeta({
      ...meta,
      user_agent:
        typeof navigator !== 'undefined' ? navigator.userAgent?.slice(0, 250) : undefined,
    });

    await client.rpc('log_login_failure', {
      p_identifier: safeIdentifier,
      p_reason: reason,
      p_meta: safeMeta,
    });
  } catch {
    // Fire-and-forget
  }
}

export function isSchemaCacheMissingRpcError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as Record<string, unknown>;
  const code = String(anyErr?.code ?? '');
  const msg = String(anyErr?.message ?? anyErr?.details ?? err ?? '').toLowerCase();
  if (code === 'PGRST202') return true;
  return msg.includes('could not find the function') && msg.includes('in the schema cache');
}

export function formatAuditRpcErrorMessage(
  err: unknown,
  language: 'fr' | 'en' | 'nl' = 'fr'
): string {
  if (isSchemaCacheMissingRpcError(err)) {
    if (language === 'en') {
      return 'SQL script out of date — run install_v54.sql';
    }
    if (language === 'nl') {
      return 'SQL-script verouderd — voer install_v54.sql uit';
    }
    return 'Script SQL non à jour — exécutez install_v54.sql';
  }
  const anyErr = err as Record<string, unknown>;
  return String(anyErr?.message ?? anyErr?.details ?? err ?? '');
}

export async function searchAuditLogsOnServer(
  client: SupabaseClient,
  filters: AuditLogSearchFilters,
  signal?: AbortSignal
): Promise<{ rows: ServerAuditLogRow[]; totalCount: number }> {
  const rpcParams = buildSearchAuditLogsRpcParams(filters);
  let query = client.rpc('search_audit_logs', rpcParams);
  if (signal && typeof (query as any).abortSignal === 'function') {
    query = (query as any).abortSignal(signal);
  }
  const { data, error } = await query;
  if (error) {
    if (isSchemaCacheMissingRpcError(error)) {
      const wrapped = new Error('Script SQL non à jour — exécutez install_v54.sql') as Error & {
        code?: string;
      };
      wrapped.code = (error as any).code || 'PGRST202';
      throw wrapped;
    }
    throw error;
  }
  const rawList = Array.isArray(data) ? data : [];
  const totalCount = rawList.length > 0 ? Number(rawList[0].total_count ?? rawList.length) : 0;
  const rows: ServerAuditLogRow[] = rawList.map((item: any) => {
    const rd = item?.row_data || item || {};
    return {
      id: String(rd.id || ''),
      app: String(rd.app || 'stock'),
      created_at: String(rd.created_at || rd.timestamp || new Date().toISOString()),
      user_id: rd.user_id ?? null,
      user_name: String(rd.user_name || 'Système'),
      user_trigram: rd.user_trigram ?? null,
      type: String(rd.type || rd.action || 'SYSTEM'),
      action: String(rd.action || rd.type || 'SYSTEM'),
      category: String(rd.category || 'SYSTEM'),
      severity: String(rd.severity || 'INFO'),
      title: String(rd.title || rd.action || rd.type || 'Événement'),
      description: String(rd.description || ''),
      ip_address: rd.ip_address ?? null,
      table_name: rd.table_name ?? rd.meta?.table ?? null,
      record_id: rd.record_id ?? rd.meta?.record_id ?? null,
      product_id: rd.product_id ?? null,
      product_ref: rd.product_ref ?? null,
      quantity_changed: rd.quantity_changed ?? null,
      site_number: rd.site_number ?? null,
      depot_name: rd.depot_name ?? null,
      meta: rd.meta && typeof rd.meta === 'object' ? rd.meta : {},
    };
  });
  return { rows, totalCount };
}

export async function searchLoginLogsOnServer(
  client: SupabaseClient,
  filters: LoginLogSearchFilters,
  signal?: AbortSignal
): Promise<{ rows: ServerLoginLogRow[]; totalCount: number }> {
  const rpcParams = buildSearchLoginLogsRpcParams(filters);
  let query = client.rpc('search_login_logs', rpcParams);
  if (signal && typeof (query as any).abortSignal === 'function') {
    query = (query as any).abortSignal(signal);
  }
  const { data, error } = await query;
  if (error) {
    if (isSchemaCacheMissingRpcError(error)) {
      const wrapped = new Error('Script SQL non à jour — exécutez install_v54.sql') as Error & {
        code?: string;
      };
      wrapped.code = (error as any).code || 'PGRST202';
      throw wrapped;
    }
    throw error;
  }
  const rawList = Array.isArray(data) ? data : [];
  const totalCount = rawList.length > 0 ? Number(rawList[0].total_count ?? rawList.length) : 0;
  const rows: ServerLoginLogRow[] = rawList.map((item: any) => {
    const rd = item?.row_data || item || {};
    return {
      id: String(rd.id || ''),
      app: String(rd.app || 'stock'),
      created_at: String(rd.created_at || rd.timestamp || new Date().toISOString()),
      user_id: rd.user_id ?? null,
      user_name: String(rd.user_name || rd.identifier || 'Inconnu'),
      user_trigram: rd.user_trigram ?? null,
      identifier: String(rd.identifier || rd.user_name || ''),
      action: String(rd.action || 'LOGIN_SUCCESS'),
      reason: rd.reason ?? null,
      ip_address: rd.ip_address ?? null,
      user_agent: rd.user_agent ?? null,
      meta: rd.meta && typeof rd.meta === 'object' ? rd.meta : {},
      failure_count_for_identifier: Number(rd.failure_count_for_identifier || 0),
    };
  });
  return { rows, totalCount };
}

export async function purgeAuditLogsOnServer(
  client: SupabaseClient,
  olderThanDays: number
): Promise<PurgeAuditLogsResult> {
  const safeDays = Math.max(90, Math.floor(Number(olderThanDays) || 90));
  const { data, error } = await client.rpc('purge_audit_logs', {
    p_older_than_days: safeDays,
  });
  if (error) {
    throw error;
  }
  return {
    older_than_days: Number(data?.older_than_days ?? safeDays),
    deleted_audit_logs: Number(data?.deleted_audit_logs ?? 0),
    deleted_login_logs: Number(data?.deleted_login_logs ?? 0),
    total_deleted: Number(data?.total_deleted ?? 0),
  };
}
