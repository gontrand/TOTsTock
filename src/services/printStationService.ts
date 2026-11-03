import { getClientSupabase } from './clientSupabase';
import { MaterialOrder, Product } from '../types';
import {
  CanonicalPrintLabelFormat,
  OrderReadyLabelData,
  ProductLabelVisuals,
  buildFullPrintableDocumentHtml,
  generateProductVisualsMap,
  renderOrderReadyLabelSheetHtml,
  renderProductLabelsSheetHtml,
  toCanonicalPrintFormat,
  triggerDirectBrowserPrint,
} from './labelRendering';
import { generateQrCodeDataUrlWithTotLogo } from '../utils/qrCodeHelper';
import {
  getDesktopPrintSettings,
  getLabelPageDimensionsMm,
  isDesktopApp,
  printDesktopLabel,
} from './desktopBridge';

export type PrintJobKind = 'order_label' | 'product_label';
export type PrintJobStatus = 'PENDING' | 'PRINTING' | 'DONE' | 'FAILED' | 'CANCELLED';

export interface PrintStationRecord {
  id: string;
  name: string;
  depot_name: string | null;
  owner_user_id: string;
  last_seen_at: string | null;
  is_active: boolean;
  is_online: boolean;
  is_mine: boolean;
  pending_count: number;
  created_at: string;
}

export interface PrintJobPayload {
  order_id?: string;
  order_number?: string;
  site_number?: string;
  site_name?: string;
  requester_name?: string;
  pickup_zone?: string;
  depot_name?: string;
  product_id?: string;
  product_ref?: string;
}

export interface PrintJobRecord {
  id: string;
  station_id: string;
  created_by: string;
  kind: PrintJobKind;
  format: CanonicalPrintLabelFormat;
  payload: PrintJobPayload;
  copies: number;
  status: PrintJobStatus;
  error?: string | null;
  dedupe_key?: string | null;
  created_at: string;
  printed_at?: string | null;
  expires_at: string;
}

export const PRINT_STATION_ID_KEY = 'tot_print_station_id';
export const PRINT_STATION_NAME_KEY = 'tot_print_station_name';
export const PRINT_STATION_DEPOT_KEY = 'tot_print_station_depot';
export const PRINT_STATION_AUTO_MODE_KEY = 'tot_print_station_auto_mode';
export const PRINT_STATION_SOUND_KEY = 'tot_print_station_sound_enabled';
export const PRINT_STATION_BLINK_KEY = 'tot_print_station_blink_enabled';
export const SCANNER_SELECTED_STATION_KEY = 'tot_scanner_selected_station_id';
export const SCANNER_SELECTED_FORMAT_KEY = 'tot_scanner_selected_label_format';

export const ALLOWED_PRINT_FORMATS: CanonicalPrintLabelFormat[] = [
  'avery_70x37',
  'avery_105x42',
  'thermal_50x30',
  'bin_90x50',
];

// ---------------------------------------------------------------------------
// Préférences locales du poste d'impression et du scanner
// ---------------------------------------------------------------------------
export function getSavedPrintStationId(): string | null {
  try {
    return localStorage.getItem(PRINT_STATION_ID_KEY);
  } catch {
    return null;
  }
}

export function setSavedPrintStationConfig(id: string | null, name?: string, depot?: string | null): void {
  try {
    if (!id) {
      localStorage.removeItem(PRINT_STATION_ID_KEY);
      return;
    }
    localStorage.setItem(PRINT_STATION_ID_KEY, id);
    if (name !== undefined) localStorage.setItem(PRINT_STATION_NAME_KEY, name);
    if (depot !== undefined) localStorage.setItem(PRINT_STATION_DEPOT_KEY, depot || '');
  } catch {
    // Ignore storage errors
  }
}

export function getSavedPrintStationMeta(): { id: string | null; name: string; depot: string } {
  try {
    return {
      id: localStorage.getItem(PRINT_STATION_ID_KEY),
      name: localStorage.getItem(PRINT_STATION_NAME_KEY) || '',
      depot: localStorage.getItem(PRINT_STATION_DEPOT_KEY) || '',
    };
  } catch {
    return { id: null, name: '', depot: '' };
  }
}

export function isPrintStationAutoModeEnabled(): boolean {
  try {
    return localStorage.getItem(PRINT_STATION_AUTO_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setPrintStationAutoModeEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PRINT_STATION_AUTO_MODE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore
  }
}

export function isPrintStationSoundEnabled(): boolean {
  try {
    const val = localStorage.getItem(PRINT_STATION_SOUND_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export function setPrintStationSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PRINT_STATION_SOUND_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore
  }
}

export function isPrintStationBlinkEnabled(): boolean {
  try {
    const val = localStorage.getItem(PRINT_STATION_BLINK_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export function setPrintStationBlinkEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PRINT_STATION_BLINK_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore
  }
}

export function getScannerSelectedStationId(): string | null {
  try {
    return localStorage.getItem(SCANNER_SELECTED_STATION_KEY);
  } catch {
    return null;
  }
}

export function setScannerSelectedStationId(stationId: string | null): void {
  try {
    if (!stationId) {
      localStorage.removeItem(SCANNER_SELECTED_STATION_KEY);
    } else {
      localStorage.setItem(SCANNER_SELECTED_STATION_KEY, stationId);
    }
  } catch {
    // Ignore
  }
}

export function getScannerSelectedLabelFormat(): CanonicalPrintLabelFormat {
  try {
    const raw = localStorage.getItem(SCANNER_SELECTED_FORMAT_KEY);
    if (raw && ALLOWED_PRINT_FORMATS.includes(raw as CanonicalPrintLabelFormat)) {
      return raw as CanonicalPrintLabelFormat;
    }
  } catch {
    // Ignore
  }
  return 'thermal_50x30';
}

export function setScannerSelectedLabelFormat(format: CanonicalPrintLabelFormat): void {
  try {
    localStorage.setItem(SCANNER_SELECTED_FORMAT_KEY, toCanonicalPrintFormat(format));
  } catch {
    // Ignore
  }
}

export function isPrintStationOnline(
  lastSeenAt: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!lastSeenAt) return false;
  const ts = Date.parse(lastSeenAt);
  if (Number.isNaN(ts)) return false;
  return nowMs - ts < 90_000;
}

// ---------------------------------------------------------------------------
// Validation pure des demandes d'impression et gestion de file côté poste
// ---------------------------------------------------------------------------
export function validatePrintJobRequest(params: {
  kind: PrintJobKind;
  format: string;
  payload: Record<string, unknown>;
  copies: number;
}): { valid: boolean; error?: string } {
  const { kind, format, payload, copies } = params;

  if (kind !== 'order_label' && kind !== 'product_label') {
    return { valid: false, error: "Type d'étiquette invalide" };
  }

  if (!ALLOWED_PRINT_FORMATS.includes(format as CanonicalPrintLabelFormat)) {
    return { valid: false, error: "Format d'étiquette invalide" };
  }

  if (!Number.isInteger(copies) || copies < 1 || copies > 100) {
    return { valid: false, error: 'Le nombre de copies doit être compris entre 1 et 100' };
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'Payload invalide' };
  }

  const serialized = JSON.stringify(payload);
  const byteLen = new TextEncoder().encode(serialized).length;
  if (byteLen > 2048) {
    return { valid: false, error: `Payload trop volumineux (${byteLen} octets > 2048 octets)` };
  }

  if (/<\s*\/?\s*(script|iframe|object|embed|style|link|meta|html|body|svg|img|div|span|table|form|input|button)/i.test(serialized)) {
    return { valid: false, error: 'Le payload ne doit jamais contenir de HTML' };
  }

  for (const [k, v] of Object.entries(payload)) {
    if (v !== null && v !== undefined && !['string', 'number', 'boolean'].includes(typeof v)) {
      return { valid: false, error: `Champ "${k}" invalide (valeur courte attendue)` };
    }
    if (typeof v === 'string' && v.length > 250) {
      return { valid: false, error: `Champ "${k}" trop long (> 250 caractères)` };
    }
  }

  if (kind === 'order_label' && !String(payload.order_number || '').trim()) {
    return { valid: false, error: 'order_number requis pour une étiquette de commande' };
  }

  if (
    kind === 'product_label' &&
    !String(payload.product_id || '').trim() &&
    !String(payload.product_ref || '').trim()
  ) {
    return { valid: false, error: 'product_id ou product_ref requis pour une étiquette produit' };
  }

  return { valid: true };
}

/**
 * Fusionne de manière idempotente les travaux nouvellement réservés (`claim_print_jobs`)
 * avec la file locale du poste d'impression, triés du plus ancien au plus récent.
 */
export function mergeClaimedPrintJobs(
  existingQueue: PrintJobRecord[],
  claimedJobs: PrintJobRecord[]
): PrintJobRecord[] {
  const byId = new Map<string, PrintJobRecord>();
  for (const job of existingQueue) {
    byId.set(job.id, job);
  }
  for (const job of claimedJobs) {
    byId.set(job.id, { ...job, status: 'PRINTING' });
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

/**
 * Met à jour l'état local d'un travail après impression (`DONE` ou `FAILED`)
 * et conserve les 20 derniers travaux dans le journal.
 */
export function applyJobCompletionToState(
  queue: PrintJobRecord[],
  history: PrintJobRecord[],
  jobId: string,
  ok: boolean,
  error?: string | null
): { queue: PrintJobRecord[]; history: PrintJobRecord[] } {
  const nowIso = new Date().toISOString();
  const target =
    queue.find((j) => j.id === jobId) || history.find((j) => j.id === jobId);

  const updatedQueue = queue.filter((j) => j.id !== jobId);
  if (!target) {
    return { queue: updatedQueue, history: history.slice(0, 20) };
  }

  const updatedJob: PrintJobRecord = {
    ...target,
    status: ok ? 'DONE' : 'FAILED',
    printed_at: ok ? nowIso : target.printed_at || null,
    error: ok ? null : error || "Impression annulée ou en échec",
  };

  const nextHistory = [
    updatedJob,
    ...history.filter((h) => h.id !== jobId),
  ].slice(0, 20);

  return { queue: updatedQueue, history: nextHistory };
}

/**
 * Réintègre un travail en échec (`FAILED`) dans la file d'attente du poste pour relance manuelle.
 */
export function retryFailedJobInState(
  queue: PrintJobRecord[],
  history: PrintJobRecord[],
  jobId: string
): { queue: PrintJobRecord[]; history: PrintJobRecord[]; jobToPrint: PrintJobRecord | null } {
  const failedJob =
    history.find((j) => j.id === jobId) || queue.find((j) => j.id === jobId);
  if (!failedJob) {
    return { queue, history, jobToPrint: null };
  }

  const restarted: PrintJobRecord = {
    ...failedJob,
    status: 'PRINTING',
    error: null,
  };

  const nextQueue = mergeClaimedPrintJobs(queue, [restarted]);
  const nextHistory = history.map((h) => (h.id === jobId ? restarted : h));
  return { queue: nextQueue, history: nextHistory, jobToPrint: restarted };
}

// ---------------------------------------------------------------------------
// Construction du document HTML imprimable côté poste à partir d'un PrintJobRecord
// ---------------------------------------------------------------------------
export async function buildPrintableHtmlForStationJob(
  job: PrintJobRecord,
  products: Product[],
  orders: MaterialOrder[],
  options: { canViewPrices?: boolean; locale?: string; visualsCache?: Record<string, ProductLabelVisuals> } = {}
): Promise<{ html: string; title: string; error?: string }> {
  const safeCopies = Math.min(Math.max(Math.trunc(Number(job.copies) || 1), 1), 100);
  const format = toCanonicalPrintFormat(job.format);

  if (job.kind === 'order_label') {
    const orderNum = String(job.payload?.order_number || '').trim();
    const matchedOrder = orders.find(
      (o) =>
        (job.payload?.order_id && o.id === job.payload.order_id) ||
        (orderNum && o.order_number.toLowerCase() === orderNum.toLowerCase())
    );

    const finalOrderNumber = matchedOrder?.order_number || orderNum;
    if (!finalOrderNumber) {
      return { html: '', title: '', error: 'Numéro de commande manquant dans le travail' };
    }

    let qrDataUrl = '';
    try {
      qrDataUrl = await generateQrCodeDataUrlWithTotLogo(`TOT-ORDER:${finalOrderNumber}`, {
        size: 180,
        margin: 1,
      });
    } catch {
      qrDataUrl = '';
    }

    const orderLabelData: OrderReadyLabelData = {
      order_number: finalOrderNumber,
      site_number: matchedOrder?.site_number || String(job.payload?.site_number || ''),
      site_name: matchedOrder?.site_name || String(job.payload?.site_name || ''),
      requester_name: matchedOrder?.requester_name || String(job.payload?.requester_name || ''),
      pickup_zone: matchedOrder?.pickup_zone || String(job.payload?.pickup_zone || 'Zone Retrait'),
      depot_name: matchedOrder?.depot_name || String(job.payload?.depot_name || ''),
      qrDataUrl,
    };

    const sheetHtml = renderOrderReadyLabelSheetHtml(orderLabelData, format, safeCopies);
    const title = `Étiquette Commande ${finalOrderNumber}`;
    return {
      html: buildFullPrintableDocumentHtml(sheetHtml, format, title),
      title,
    };
  }

  // product_label
  const prodId = String(job.payload?.product_id || '').trim();
  const prodRef = String(job.payload?.product_ref || '').trim().toLowerCase();
  const matchedProduct = products.find(
    (p) =>
      (prodId && p.id === prodId) ||
      (prodRef && p.reference.trim().toLowerCase() === prodRef)
  );

  if (!matchedProduct) {
    return {
      html: '',
      title: '',
      error: `Article introuvable dans le catalogue (${prodId || prodRef || '?'})`,
    };
  }

  const visualsMap = await generateProductVisualsMap([matchedProduct], {
    showQr: true,
    showBarcode: true,
    existingCache: options.visualsCache,
  });

  const repeatedItems: Product[] = [];
  for (let i = 0; i < safeCopies; i++) {
    repeatedItems.push(matchedProduct);
  }

  const sheetHtml = renderProductLabelsSheetHtml(repeatedItems, {
    format,
    showQr: true,
    showBarcode: true,
    showLocation: true,
    showOem: true,
    showPrice: false,
    canViewPrices: options.canViewPrices ?? false,
    locale: options.locale || 'fr-FR',
    imagesCache: visualsMap,
  });

  const title = `Étiquette Article ${matchedProduct.reference} (x${safeCopies})`;
  return {
    html: buildFullPrintableDocumentHtml(sheetHtml, format, title),
    title,
  };
}

// ---------------------------------------------------------------------------
// Appels RPC Supabase (postes et travaux d'impression)
// ---------------------------------------------------------------------------
export async function rpcRegisterPrintStation(
  name: string,
  depotName?: string | null
): Promise<{ stationId?: string; error?: string }> {
  const client = getClientSupabase();
  if (!client) return { error: 'Client Supabase non initialisé' };

  const { data, error } = await client.rpc('register_print_station', {
    p_name: name.trim(),
    p_depot: depotName?.trim() || null,
  });

  if (error) {
    return { error: error.message || "Erreur lors de l'enregistrement du poste" };
  }
  return { stationId: String(data) };
}

export async function rpcListPrintStations(): Promise<{
  stations: PrintStationRecord[];
  error?: string;
}> {
  const client = getClientSupabase();
  if (!client) return { stations: [], error: 'Client Supabase non initialisé' };

  const { data, error } = await client.rpc('list_print_stations');
  if (error) {
    return { stations: [], error: error.message };
  }

  const rows = Array.isArray(data) ? data : [];
  return {
    stations: rows.map((r: any) => ({
      id: String(r.id),
      name: String(r.name || ''),
      depot_name: r.depot_name ? String(r.depot_name) : null,
      owner_user_id: String(r.owner_user_id || ''),
      last_seen_at: r.last_seen_at ? String(r.last_seen_at) : null,
      is_active: Boolean(r.is_active),
      is_online: Boolean(r.is_online),
      is_mine: Boolean(r.is_mine),
      pending_count: Number(r.pending_count || 0),
      created_at: String(r.created_at || new Date().toISOString()),
    })),
  };
}

export async function rpcCreatePrintJob(params: {
  stationId: string;
  kind: PrintJobKind;
  format: CanonicalPrintLabelFormat;
  payload: PrintJobPayload;
  copies?: number;
  dedupeKey?: string | null;
}): Promise<{ jobId?: string; duplicate?: boolean; error?: string }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { error: 'OFFLINE' };
  }

  const copies = params.copies ?? 1;
  const format = toCanonicalPrintFormat(params.format);
  const validation = validatePrintJobRequest({
    kind: params.kind,
    format,
    payload: params.payload as Record<string, unknown>,
    copies,
  });

  if (!validation.valid) {
    return { error: validation.error };
  }

  const client = getClientSupabase();
  if (!client) return { error: 'Client Supabase non initialisé' };

  const { data, error } = await client.rpc('create_print_job', {
    p_station: params.stationId,
    p_kind: params.kind,
    p_format: format,
    p_payload: params.payload,
    p_copies: copies,
    p_dedupe_key: params.dedupeKey || null,
  });

  if (error) {
    if (error.code === '23505' || /unique|dedupe/i.test(error.message || '')) {
      return { duplicate: true, error: "Ce travail d'impression est déjà en attente sur ce poste." };
    }
    return { error: error.message || "Erreur lors de l'envoi au poste d'impression" };
  }

  // Notification broadcast optionnelle sur le canal de la station pour réveil instantané
  try {
    const ch = client.channel(`tot-print-station-${params.stationId}`);
    ch.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        ch.send({
          type: 'broadcast',
          event: 'new_print_job',
          payload: { job_id: String(data), station_id: params.stationId },
        }).finally(() => {
          client.removeChannel(ch);
        });
      }
    });
  } catch {
    // Le repli par interrogation 10s ou postgres_changes prendra le relais
  }

  return { jobId: String(data) };
}

export async function rpcClaimPrintJobs(stationId: string): Promise<{
  jobs: PrintJobRecord[];
  error?: string;
}> {
  const client = getClientSupabase();
  if (!client) return { jobs: [], error: 'Client Supabase non initialisé' };

  const { data, error } = await client.rpc('claim_print_jobs', {
    p_station: stationId,
  });

  if (error) {
    return { jobs: [], error: error.message };
  }

  const rows = Array.isArray(data) ? data : [];
  return {
    jobs: rows.map(normalizePrintJobRow),
  };
}

export async function rpcListStationPrintJobs(
  stationId: string,
  limit = 20
): Promise<{ jobs: PrintJobRecord[]; error?: string }> {
  const client = getClientSupabase();
  if (!client) return { jobs: [], error: 'Client Supabase non initialisé' };

  const { data, error } = await client.rpc('list_station_print_jobs', {
    p_station: stationId,
    p_limit: limit,
  });

  if (error) {
    return { jobs: [], error: error.message };
  }

  const rows = Array.isArray(data) ? data : [];
  return {
    jobs: rows.map(normalizePrintJobRow),
  };
}

export async function rpcCompletePrintJob(
  jobId: string,
  ok: boolean,
  errorText?: string | null
): Promise<{ job?: PrintJobRecord; error?: string }> {
  const client = getClientSupabase();
  if (!client) return { error: 'Client Supabase non initialisé' };

  const { data, error } = await client.rpc('complete_print_job', {
    p_job: jobId,
    p_ok: ok,
    p_error: errorText || null,
  });

  if (error) {
    return { error: error.message };
  }
  return { job: data ? normalizePrintJobRow(data) : undefined };
}

export async function rpcCancelPrintJob(
  jobId: string
): Promise<{ job?: PrintJobRecord; error?: string }> {
  const client = getClientSupabase();
  if (!client) return { error: 'Client Supabase non initialisé' };

  const { data, error } = await client.rpc('cancel_print_job', {
    p_job: jobId,
  });

  if (error) {
    return { error: error.message };
  }
  return { job: data ? normalizePrintJobRow(data) : undefined };
}

export async function rpcGetPrintJobStatus(
  jobId: string
): Promise<{ status?: PrintJobStatus; errorText?: string | null; error?: string }> {
  const client = getClientSupabase();
  if (!client) return { error: 'Client Supabase non initialisé' };

  const { data, error } = await client.rpc('get_print_job_status', {
    p_job: jobId,
  });

  if (error) {
    return { error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { error: 'Travail introuvable' };
  }

  return {
    status: row.status as PrintJobStatus,
    errorText: row.error || null,
  };
}

export async function rpcPurgePrintJobs(): Promise<{ deletedCount: number; error?: string }> {
  const client = getClientSupabase();
  if (!client) return { deletedCount: 0, error: 'Client Supabase non initialisé' };

  const { data, error } = await client.rpc('purge_print_jobs');
  if (error) {
    return { deletedCount: 0, error: error.message };
  }
  return { deletedCount: Number(data || 0) };
}

function normalizePrintJobRow(r: any): PrintJobRecord {
  return {
    id: String(r.id),
    station_id: String(r.station_id),
    created_by: String(r.created_by || ''),
    kind: (r.kind === 'order_label' ? 'order_label' : 'product_label') as PrintJobKind,
    format: toCanonicalPrintFormat(String(r.format || 'avery_70x37')),
    payload: (r.payload && typeof r.payload === 'object' ? r.payload : {}) as PrintJobPayload,
    copies: Number(r.copies || 1),
    status: (r.status || 'PENDING') as PrintJobStatus,
    error: r.error ? String(r.error) : null,
    dedupe_key: r.dedupe_key ? String(r.dedupe_key) : null,
    created_at: String(r.created_at || new Date().toISOString()),
    printed_at: r.printed_at ? String(r.printed_at) : null,
    expires_at: String(r.expires_at || new Date().toISOString()),
  };
}

// ---------------------------------------------------------------------------
// Alertes sonores discrètes et clignotement de l'onglet du poste d'impression
// ---------------------------------------------------------------------------
export function playPrintStationNotificationChime(): void {
  if (!isPrintStationSoundEnabled()) return;
  try {
    const AudioCtx =
      typeof window !== 'undefined'
        ? window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        : null;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.33);
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 450);
  } catch {
    // Ignore audio context restrictions
  }
}

// ---------------------------------------------------------------------------
// Exécution de l'impression (Pont bureau Electron ou repli navigateur web)
// ---------------------------------------------------------------------------
export interface DispatchStationPrintParams {
  html: string;
  format?: string | null;
  copies?: number;
  printerName?: string;
  silent?: boolean;
}

export async function dispatchStationPrintDocument(
  params: DispatchStationPrintParams
): Promise<{ ok: boolean; error?: string; usedDesktopBridge: boolean }> {
  const safeCopies = Math.min(Math.max(Math.trunc(Number(params.copies) || 1), 1), 100);

  if (isDesktopApp()) {
    const savedSettings = await getDesktopPrintSettings();
    const printerName =
      typeof params.printerName === 'string' && params.printerName.trim()
        ? params.printerName.trim()
        : savedSettings.printerName;
    const silent =
      typeof params.silent === 'boolean' ? params.silent : savedSettings.silent;
    const { pageWidthMm, pageHeightMm } = getLabelPageDimensionsMm(params.format);

    const res = await printDesktopLabel({
      html: params.html,
      pageWidthMm,
      pageHeightMm,
      printerName,
      copies: safeCopies,
      silent,
    });

    return {
      ok: res.ok,
      error: res.errorMessage,
      usedDesktopBridge: true,
    };
  }

  const browserRes = await triggerDirectBrowserPrint(params.html);
  return {
    ok: browserRes.ok,
    error: browserRes.error,
    usedDesktopBridge: false,
  };
}

export async function executeStationPrintJob(
  job: PrintJobRecord,
  products: Product[],
  orders: MaterialOrder[],
  options: {
    canViewPrices?: boolean;
    locale?: string;
    printerName?: string;
    silent?: boolean;
  } = {}
): Promise<{ ok: boolean; title: string; error?: string; usedDesktopBridge: boolean }> {
  const safeCopies = Math.min(Math.max(Math.trunc(Number(job.copies) || 1), 1), 100);
  const desktopMode = isDesktopApp();
  const canonicalFormat = toCanonicalPrintFormat(job.format);

  // En mode bureau sur étiquette thermique, on génère 1 étiquette dans le HTML et on passe `copies` au pilote
  const jobForHtml: PrintJobRecord =
    desktopMode && canonicalFormat === 'thermal_50x30'
      ? { ...job, copies: 1 }
      : job;

  const built = await buildPrintableHtmlForStationJob(jobForHtml, products, orders, {
    canViewPrices: options.canViewPrices,
    locale: options.locale,
  });

  if (!built.html || built.error) {
    return {
      ok: false,
      title: built.title || '',
      error: built.error || "Impossible de générer l'étiquette",
      usedDesktopBridge: desktopMode,
    };
  }

  const printCopies =
    desktopMode && canonicalFormat === 'thermal_50x30' ? safeCopies : desktopMode ? 1 : safeCopies;

  const printRes = await dispatchStationPrintDocument({
    html: built.html,
    format: canonicalFormat,
    copies: printCopies,
    printerName: options.printerName,
    silent: options.silent,
  });

  return {
    ok: printRes.ok,
    title: built.title,
    error: printRes.error,
    usedDesktopBridge: printRes.usedDesktopBridge,
  };
}

