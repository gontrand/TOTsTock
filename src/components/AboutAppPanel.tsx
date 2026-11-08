import React, { useState, useEffect, useCallback } from 'react';
import {
  APP_VERSION,
  EXPECTED_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
  compareSemver,
} from '../appVersion';
import { RECENT_CHANGELOG } from '../data/changelog';
import { useApp } from '../context/AppContext';
import { tr } from '../i18n/dutchTranslator';
import {
  PLAN_LABELS,
  normalizePlanType,
  getPlanMaxReferences,
  getSavedLicense,
  enforceSignedLicenseQuotasSync,
} from '../services/licenseService';
import { getLocalCryptoMode, CryptoProviderMode } from '../services/localCrypto';
import { isDesktopApp, openExternalUrl } from '../services/desktopBridge';
import { getClientSupabase } from '../services/clientSupabase';
import {
  EDGE_FUNCTIONS,
  EdgeFunctionPingItemResult,
  pingClientEdgeFunctions,
} from '../constants/edgeFunctions';
import { CURRENT_MAIL_APP_CODE } from '../constants/tables';
import { fetchSuiteMailSenders } from '../services/mailingService';
import {
  DesktopTargetOs,
  detectClientDesktopOs,
  getConfiguredBinaryInstallerUrl,
} from '../utils/desktopInstallerDownload';
import { buildApkDownloadUrl } from '../utils/apkDownload';
import {
  BadgeCheck,
  AlertTriangle,
  Database,
  ShieldCheck,
  Server,
  Mail,
  Lock,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  Scale,
  Code2,
  Download,
  Monitor,
  Smartphone,
  ExternalLink,
} from 'lucide-react';

export const APP_BUILD_DATE = '2026-11-08';

export function computeAboutLicenseSnapshot() {
  const lic = getSavedLicense();
  const q = enforceSignedLicenseQuotasSync(lic);
  const planLabel = PLAN_LABELS[q.plan];
  const maxRefs = q.max_references;
  const maxDepots = q.max_depots;
  const rawSignedToken: unknown = lic.signed_token;
  const signedTokenPresent = Boolean(
    typeof rawSignedToken === 'string'
      ? rawSignedToken.trim().length > 0
      : rawSignedToken &&
          typeof rawSignedToken === 'object' &&
          Object.keys(rawSignedToken as Record<string, unknown>).length > 0
  );
  const expiresAt = lic.expires_at ?? null;

  return {
    canonicalPlan: q.plan,
    planLabel,
    maxRefs,
    maxDepots,
    signedTokenPresent,
    expiresAt,
  };
}

export type SchemaVersionState = 'up_to_date' | 'tolerated' | 'outdated' | 'unknown';

export function evaluateDbSchemaStatus(
  actualSchemaVersion?: string | null,
  expectedSchemaVersion = EXPECTED_SCHEMA_VERSION,
  minSupportedSchemaVersion = MIN_SUPPORTED_SCHEMA_VERSION
): SchemaVersionState {
  const cleaned = String(actualSchemaVersion || '').trim();
  if (!cleaned) return 'unknown';
  if (compareSemver(cleaned, minSupportedSchemaVersion) < 0) {
    return 'outdated';
  }
  if (compareSemver(cleaned, expectedSchemaVersion) < 0) {
    return 'tolerated';
  }
  return 'up_to_date';
}

/**
 * Extrait uniquement le nom d'hôte (ex. "xyz.supabase.co") sans chemin, paramètre ni jeton.
 */
export function extractSafeSupabaseHost(rawUrl?: string | null): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return 'non connecté';
  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    return parsed.host || 'non connecté';
  } catch {
    return 'non connecté';
  }
}

export function detectRuntimePlatformLabel(): string {
  if (isDesktopApp()) {
    return 'Desktop Electron';
  }
  const cap = (globalThis as any)?.Capacitor;
  if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) {
    return 'Android / Mobile Capacitor';
  }
  return 'Web / PWA';
}

export function countPendingOfflineOperationsSafe(): number {
  let total = 0;
  try {
    const rawScannerQueue = localStorage.getItem('tot_scanner_offline_queue_v1');
    if (rawScannerQueue && rawScannerQueue.startsWith('[')) {
      const arr = JSON.parse(rawScannerQueue);
      if (Array.isArray(arr)) {
        total += arr.filter((x) => x && x.status !== 'synced').length;
      }
    }
  } catch {
    // Ignorer (ou enveloppe chiffrée)
  }
  return total;
}

export interface DiagnosticSupportSummaryInput {
  appVersion?: string;
  expectedSchemaVersion?: string;
  minSupportedSchemaVersion?: string;
  actualSchemaVersion?: string | null;
  buildDate?: string;
  platform?: string;
  planCode?: string;
  referencesUsed?: number;
  referencesMax?: number;
  depotsUsed?: number;
  depotsMax?: number;
  usersUsed?: number;
  signedTokenPresent?: boolean;
  supabaseUrl?: string | null;
  edgeResults?: Array<{ functionName: string; ok: boolean; state?: string }>;
  appSenderName?: string;
  appSenderEmail?: string;
  encryptionMode?: CryptoProviderMode;
  pendingOfflineCount?: number;
}

/**
 * Génère le texte brut de diagnostic destiné au support technique.
 * GARANTIE SÉCURITÉ : Ne contient jamais de clé API, clé Supabase, jeton signé, mot de passe, PIN ou donnée personnelle.
 */
export function formatDiagnosticSupportSummary(
  input: DiagnosticSupportSummaryInput
): string {
  const appVer = input.appVersion || APP_VERSION;
  const expSchema = input.expectedSchemaVersion || EXPECTED_SCHEMA_VERSION;
  const minSchema = input.minSupportedSchemaVersion || MIN_SUPPORTED_SCHEMA_VERSION;
  const actSchema = input.actualSchemaVersion ? String(input.actualSchemaVersion) : 'inconnu';
  const schemaState = evaluateDbSchemaStatus(input.actualSchemaVersion, expSchema, minSchema);
  const schemaLabel =
    schemaState === 'up_to_date'
      ? 'À jour'
      : schemaState === 'tolerated'
      ? 'Tolérée — mise à jour recommandée'
      : schemaState === 'outdated'
      ? 'Trop ancienne'
      : 'Non vérifié';

  const safeHost = extractSafeSupabaseHost(input.supabaseUrl);
  const canonicalPlan = normalizePlanType(input.planCode || 'free');
  const planLabel = PLAN_LABELS[canonicalPlan] || canonicalPlan.toUpperCase();

  const edgeLines =
    Array.isArray(input.edgeResults) && input.edgeResults.length > 0
      ? input.edgeResults
          .map((r) => `  - ${r.functionName}: ${r.ok ? 'OK' : r.state || 'NON DÉPLOYÉE'}`)
          .join('\n')
      : [
          `  - ${EDGE_FUNCTIONS.adminUsers}: non vérifié`,
          `  - ${EDGE_FUNCTIONS.syncLicense}: non vérifié`,
          `  - ${EDGE_FUNCTIONS.sendReportEmail}: non vérifié`,
        ].join('\n');

  const encMode = input.encryptionMode || 'none';
  const encLabel =
    encMode === 'native' ? 'Natif (Keystore / SafeStorage)' : encMode === 'pin' ? 'PIN (PBKDF2 + AES-GCM)' : 'Aucun';

  const senderSummary = input.appSenderEmail
    ? `${input.appSenderName || 'TOT Stock'} <${input.appSenderEmail}>`
    : `${input.appSenderName || 'TOT Stock'} (non configuré)`;

  const lines = [
    `=== TOT STOCK — DIAGNOSTIC SUPPORT ===`,
    `Application : TOT Stock v${appVer} (build ${input.buildDate || APP_BUILD_DATE})`,
    `Plateforme : ${input.platform || detectRuntimePlatformLabel()}`,
    `Schéma SQL : attendu v${expSchema} (min v${minSchema}) | en base : v${actSchema} (${schemaLabel})`,
    `Licence : ${planLabel} (${canonicalPlan}) | Jeton signé Ed25519 : ${
      input.signedTokenPresent ? 'présent' : 'absent'
    }`,
    `Quotas : références ${input.referencesUsed ?? 0}/${
      input.referencesMax ?? getPlanMaxReferences(canonicalPlan)
    } | dépôts actifs ${input.depotsUsed ?? 0}/${input.depotsMax ?? 1} | utilisateurs ${
      input.usersUsed ?? 0
    }`,
    `Hôte Supabase : ${safeHost}`,
    `Fonctions Edge :`,
    edgeLines,
    `Expéditeur e-mail (stk) : ${senderSummary}`,
    `Chiffrement local : ${encLabel}`,
    `Opérations hors-ligne en attente : ${input.pendingOfflineCount ?? 0}`,
  ];

  // Filet de sécurité anti-fuite : supprimer tout motif ressemblant à un JWT ou clé secrète
  return lines
    .join('\n')
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[JETON_MASQUÉ]')
    .replace(/xkeysib-[a-zA-Z0-9_-]+/gi, '[SECRET_MASQUÉ]')
    .replace(/sb_secret_[a-zA-Z0-9_-]+/gi, '[SECRET_MASQUÉ]');
}

export interface AboutAppPanelProps {
  onOpenSqlScripts?: () => void;
  compact?: boolean;
}

export const AboutAppPanel: React.FC<AboutAppPanelProps> = ({
  onOpenSqlScripts,
  compact = false,
}) => {
  const {
    language,
    appCompat,
    recheckAppCompat,
    isSupabaseConnected,
    supabaseUrl,
    supabaseKey,
    products,
    depots,
    users,
    settings,
    setCompanySetupModalOpen,
    setAppInfoModalOpen,
  } = useApp();

  const [edgeItems, setEdgeItems] = useState<EdgeFunctionPingItemResult[]>([]);
  const [checkingEdges, setCheckingEdges] = useState(false);
  const [refreshingCompat, setRefreshingCompat] = useState(false);
  const [stkSender, setStkSender] = useState<{ fromName: string; fromEmail: string }>({
    fromName: settings?.smtp_from_name || 'TOT Stock',
    fromEmail: settings?.smtp_from_email || settings?.smtp_from || '',
  });
  const [copiedDiag, setCopiedDiag] = useState(false);
  const [detectedOs] = useState<DesktopTargetOs>(() => detectClientDesktopOs());

  const encryptionMode = getLocalCryptoMode();
  const safeHost = extractSafeSupabaseHost(
    supabaseUrl || localStorage.getItem('tot_inv_supabase_url')
  );
  const schemaStatus = evaluateDbSchemaStatus(
    appCompat?.schemaVersion,
    EXPECTED_SCHEMA_VERSION,
    MIN_SUPPORTED_SCHEMA_VERSION
  );

  // Lecture de l'état de licence via getSavedLicense() + enforceSignedLicenseQuotasSync(lic)
  const lic = getSavedLicense();
  const q = enforceSignedLicenseQuotasSync(lic);
  const planLabel = PLAN_LABELS[q.plan];
  const maxRefs = q.max_references;
  const maxDepots = q.max_depots;
  const rawSignedToken: unknown = lic.signed_token;
  const signedTokenPresent = Boolean(
    typeof rawSignedToken === 'string'
      ? rawSignedToken.trim().length > 0
      : rawSignedToken &&
          typeof rawSignedToken === 'object' &&
          Object.keys(rawSignedToken as Record<string, unknown>).length > 0
  );
  const expiresAt = lic.expires_at;
  const licenseSnapshot = {
    canonicalPlan: q.plan,
    planLabel,
    maxRefs,
    maxDepots,
    signedTokenPresent,
    expiresAt,
  };

  const activeDepotsCount = depots.filter((d) => d.is_active !== false).length;
  const pendingOfflineCount = countPendingOfflineOperationsSafe();

  const loadCurrentAppSender = useCallback(async () => {
    const url = (supabaseUrl || localStorage.getItem('tot_inv_supabase_url') || '').trim();
    const key = (supabaseKey || localStorage.getItem('tot_inv_supabase_key') || '').trim();
    const client = getClientSupabase(url, key);
    if (!client) return;
    try {
      const list = await fetchSuiteMailSenders(client);
      const stk = list.find((s) => s.app_code === CURRENT_MAIL_APP_CODE);
      if (stk && (stk.from_email || stk.from_name)) {
        setStkSender({
          fromName: stk.from_name || 'TOT Stock',
          fromEmail: stk.from_email || '',
        });
      }
    } catch {
      // Ignorer
    }
  }, [supabaseKey, supabaseUrl]);

  useEffect(() => {
    loadCurrentAppSender();
  }, [loadCurrentAppSender]);

  const handleCheckAllEdgeFunctions = async () => {
    const url = (supabaseUrl || localStorage.getItem('tot_inv_supabase_url') || '').trim();
    const key = (supabaseKey || localStorage.getItem('tot_inv_supabase_key') || '').trim();
    const client = getClientSupabase(url, key);
    if (!client) return;
    setCheckingEdges(true);
    try {
      const summary = await pingClientEdgeFunctions(client);
      setEdgeItems(summary.items);
    } finally {
      setCheckingEdges(false);
    }
  };

  const handleNavigateToSqlScripts = () => {
    if (onOpenSqlScripts) {
      onOpenSqlScripts();
      return;
    }
    setAppInfoModalOpen(false);
    setCompanySetupModalOpen(true);
  };

  const handleCopyDiagnostic = () => {
    const text = formatDiagnosticSupportSummary({
      appVersion: APP_VERSION,
      expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
      minSupportedSchemaVersion: MIN_SUPPORTED_SCHEMA_VERSION,
      actualSchemaVersion: appCompat?.schemaVersion || null,
      buildDate: APP_BUILD_DATE,
      platform: detectRuntimePlatformLabel(),
      planCode: licenseSnapshot.canonicalPlan,
      referencesUsed: products.length,
      referencesMax: licenseSnapshot.maxRefs,
      depotsUsed: activeDepotsCount,
      depotsMax: licenseSnapshot.maxDepots,
      usersUsed: users.length,
      signedTokenPresent: licenseSnapshot.signedTokenPresent,
      supabaseUrl: supabaseUrl || localStorage.getItem('tot_inv_supabase_url'),
      edgeResults: edgeItems,
      appSenderName: stkSender.fromName,
      appSenderEmail: stkSender.fromEmail,
      encryptionMode,
      pendingOfflineCount,
    });
    navigator.clipboard?.writeText(text);
    setCopiedDiag(true);
    setTimeout(() => setCopiedDiag(false), 2500);
  };

  const apkDownloadUrl = buildApkDownloadUrl(appCompat.updateUrl, APP_VERSION);
  const desktopInstallerUrl = getConfiguredBinaryInstallerUrl(detectedOs, appCompat.updateUrl);

  return (
    <div className="space-y-4 text-xs text-slate-800 dark:text-slate-100 text-left">
      {/* 1. APPLICATION & SCHÉMA SQL */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
              <span>TOT Stock — v{APP_VERSION}</span>
              <span className="px-2 py-0.5 rounded-md bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 text-[10px] font-mono font-bold">
                {tr(language, 'Schéma', 'Schema', 'Schema')} {EXPECTED_SCHEMA_VERSION}
              </span>
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {tr(
                language,
                `Build ${APP_BUILD_DATE} • Plateforme : ${detectRuntimePlatformLabel()}`,
                `Build ${APP_BUILD_DATE} • Platform: ${detectRuntimePlatformLabel()}`,
                `Build ${APP_BUILD_DATE} • Platform: ${detectRuntimePlatformLabel()}`
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={handleCopyDiagnostic}
            className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white font-extrabold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
          >
            {copiedDiag ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span>
              {copiedDiag
                ? tr(
                    language,
                    'Diagnostic copié !',
                    'Diagnostic copied!',
                    'Diagnose gekopieerd!'
                  )
                : tr(
                    language,
                    'Copier les informations de diagnostic',
                    'Copy diagnostic information',
                    'Diagnose-informatie kopiëren'
                  )}
            </span>
          </button>
        </div>

        {/* Statut du schéma en base */}
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-extrabold text-slate-800 dark:text-slate-100">
              <Database className="w-3.5 h-3.5 text-sky-500" />
              <span>
                {tr(
                  language,
                  'État du schéma SQL (core_app_compat)',
                  'SQL Schema Status (core_app_compat)',
                  'SQL-schemastatus (core_app_compat)'
                )}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {schemaStatus === 'up_to_date' && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold text-[10px] flex items-center gap-1">
                  <BadgeCheck className="w-3 h-3" />
                  <span>{tr(language, 'À jour', 'Up to date', 'Up-to-date')}</span>
                </span>
              )}
              {schemaStatus === 'tolerated' && (
                <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-bold text-[10px] flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  <span>
                    {tr(
                      language,
                      'Tolérée — mise à jour recommandée',
                      'Tolerated — update recommended',
                      'Getolereerd — update aanbevolen'
                    )}
                  </span>
                </span>
              )}
              {schemaStatus === 'outdated' && (
                <span className="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold text-[10px] flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  <span>
                    {tr(language, 'Trop ancienne', 'Outdated', 'Te oud')}
                  </span>
                </span>
              )}
              {isSupabaseConnected && (
                <button
                  type="button"
                  onClick={async () => {
                    setRefreshingCompat(true);
                    await recheckAppCompat().catch(() => {});
                    setRefreshingCompat(false);
                  }}
                  className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 cursor-pointer"
                  title={tr(language, 'Actualiser', 'Refresh', 'Vernieuwen')}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshingCompat ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
            <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              <span className="text-slate-400 block text-[10px]">
                {tr(language, 'Schéma attendu', 'Expected schema', 'Verwacht schema')}
              </span>
              <span className="font-mono font-black">v{EXPECTED_SCHEMA_VERSION}</span>
            </div>
            <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              <span className="text-slate-400 block text-[10px]">
                {tr(language, 'Schéma en base', 'Database schema', 'Databaseschema')}
              </span>
              <span className="font-mono font-black">
                {appCompat?.schemaVersion ? `v${appCompat.schemaVersion}` : '—'}
              </span>
            </div>
            <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              <span className="text-slate-400 block text-[10px]">
                {tr(language, 'Minimum toléré', 'Minimum supported', 'Minimaal ondersteund')}
              </span>
              <span className="font-mono font-black">v{MIN_SUPPORTED_SCHEMA_VERSION}</span>
            </div>
          </div>

          {(schemaStatus === 'tolerated' || schemaStatus === 'outdated') && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold">
                {tr(
                  language,
                  'Exécutez les scripts SQL (jusqu’au script 17 puis 07) pour mettre la base à niveau.',
                  'Run the SQL scripts (up to script 17 then 07) to upgrade the database.',
                  'Voer de SQL-scripts uit (tot script 17 en daarna 07) om de database bij te werken.'
                )}
              </span>
              <button
                type="button"
                onClick={handleNavigateToSqlScripts}
                className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-[11px] flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <ExternalLink className="w-3 h-3" />
                <span>
                  {tr(
                    language,
                    'Ouvrir 3. Scripts SQL',
                    'Open 3. SQL Scripts',
                    'Open 3. SQL-scripts'
                  )}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 2. LICENCE & QUOTAS + 3. ÉTAT TECHNIQUE SANS SECRET */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Carte Licence */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-black text-slate-900 dark:text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>
                {tr(language, 'Licence & Quotas', 'License & Quotas', 'Licentie & Quota')}
              </span>
            </span>
            <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-mono font-black text-[11px]">
              {licenseSnapshot.planLabel}
            </span>
          </div>

          <div className="space-y-1.5 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-500">
                {tr(language, 'Références catalogue :', 'Catalog references:', 'Catalogusreferenties:')}
              </span>
              <span className="font-mono font-bold">
                {products.length} / {licenseSnapshot.maxRefs >= 99999 ? '∞' : licenseSnapshot.maxRefs}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">
                {tr(language, 'Dépôts actifs :', 'Active depots:', 'Actieve depots:')}
              </span>
              <span className="font-mono font-bold">
                {activeDepotsCount} / {licenseSnapshot.maxDepots >= 99999 ? '∞' : licenseSnapshot.maxDepots}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">
                {tr(language, 'Utilisateurs :', 'Users:', 'Gebruikers:')}
              </span>
              <span className="font-mono font-bold">{users.length} / ∞</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">
                {tr(language, 'Jeton signé Ed25519 :', 'Ed25519 signed token:', 'Ed25519-getekend token:')}
              </span>
              <span className="font-bold">
                {licenseSnapshot.signedTokenPresent
                  ? tr(language, 'Présent', 'Present', 'Aanwezig')
                  : tr(language, 'Mode Free / Non lié', 'Free / Unlinked', 'Free / Niet gekoppeld')}
              </span>
            </div>
          </div>
        </div>

        {/* Carte État technique (sans secret) */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-black text-slate-900 dark:text-white flex items-center gap-1.5">
              <Server className="w-4 h-4 text-cyan-600" />
              <span>
                {tr(
                  language,
                  'État technique (sans secret)',
                  'Technical Status (secret-free)',
                  'Technische status (zonder geheimen)'
                )}
              </span>
            </span>
          </div>

          <div className="space-y-1.5 text-[11px]">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">
                {tr(language, 'Hôte Supabase :', 'Supabase host:', 'Supabase-host:')}
              </span>
              <span className="font-mono font-bold truncate">{safeHost}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 flex items-center gap-1">
                <Mail className="w-3 h-3" />
                <span>{tr(language, 'Expéditeur (stk) :', 'Sender (stk):', 'Afzender (stk):')}</span>
              </span>
              <span className="font-mono font-bold truncate" title={`${stkSender.fromName} <${stkSender.fromEmail}>`}>
                {stkSender.fromEmail
                  ? `${stkSender.fromName} <${stkSender.fromEmail}>`
                  : `${stkSender.fromName} (${tr(language, 'non configuré', 'not configured', 'niet ingesteld')})`}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 flex items-center gap-1">
                <Lock className="w-3 h-3" />
                <span>
                  {tr(language, 'Chiffrement local :', 'Local encryption:', 'Lokale versleuteling:')}
                </span>
              </span>
              <span className="font-bold">
                {encryptionMode === 'native'
                  ? tr(language, 'Natif', 'Native', 'Native')
                  : encryptionMode === 'pin'
                  ? 'PIN (AES-GCM)'
                  : tr(language, 'Aucun', 'None', 'Geen')}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">
                {tr(language, 'Opérations hors-ligne :', 'Offline queue:', 'Offline wachtrij:')}
              </span>
              <span className="font-mono font-bold">{pendingOfflineCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3b. ÉTAT DES 3 FONCTIONS EDGE AVEC BOUTON « TOUT VÉRIFIER » */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-black text-slate-900 dark:text-white flex items-center gap-1.5">
            <Server className="w-4 h-4 text-indigo-600" />
            <span>
              {tr(
                language,
                'Fonctions Edge Supabase (3)',
                'Supabase Edge Functions (3)',
                'Supabase Edge Functions (3)'
              )}
            </span>
          </span>
          <button
            type="button"
            disabled={checkingEdges}
            onClick={handleCheckAllEdgeFunctions}
            className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[11px] flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checkingEdges ? 'animate-spin' : ''}`} />
            <span>
              {tr(language, 'Tout vérifier', 'Verify all', 'Alles controleren')}
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(
            [
              EDGE_FUNCTIONS.adminUsers,
              EDGE_FUNCTIONS.syncLicense,
              EDGE_FUNCTIONS.sendReportEmail,
            ] as const
          ).map((fnName) => {
            const found = edgeItems.find((i) => i.functionName === fnName);
            return (
              <div
                key={fnName}
                className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2"
              >
                <span className="font-mono font-bold text-[10.5px] truncate" title={fnName}>
                  {fnName}
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                    !found
                      ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      : found.ok
                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                      : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {!found
                    ? tr(language, 'Non testé', 'Untested', 'Niet getest')
                    : found.ok
                    ? 'OK'
                    : tr(language, 'Absente', 'Missing', 'Ontbreekt')}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. NOUVEAUTÉS (5 DERNIÈRES VERSIONS DEPUIS src/data/changelog.ts) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center gap-1.5 font-black text-slate-900 dark:text-white">
          <Sparkles className="w-4 h-4 text-orange-500" />
          <span>
            {tr(
              language,
              'Nouveautés (5 dernières versions)',
              'What’s New (last 5 releases)',
              'Nieuw (laatste 5 versies)'
            )}
          </span>
        </div>

        <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
          {RECENT_CHANGELOG.slice(0, 5).map((entry) => {
            const title =
              language === 'en'
                ? entry.title.en
                : language === 'nl'
                ? entry.title.nl
                : entry.title.fr;
            const highlights =
              language === 'en'
                ? entry.highlights.en
                : language === 'nl'
                ? entry.highlights.nl
                : entry.highlights.fr;

            return (
              <div
                key={entry.version}
                className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black text-slate-900 dark:text-white">
                    v{entry.version} — {title}
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    {entry.date} • SQL {entry.schemaVersion}
                  </span>
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                  {highlights.map((bullet: string, idx: number) => (
                    <li key={idx}>{bullet}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Installeurs Bureau & Mobile si pertinent */}
      {!compact && (
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-black text-slate-900 dark:text-white flex items-center gap-1.5">
              <Monitor className="w-4 h-4 text-orange-600" />
              <span>
                {tr(
                  language,
                  'Téléchargements & Installeurs (Bureau / Mobile)',
                  'Downloads & Installers (Desktop / Mobile)',
                  'Downloads & Installatieprogramma’s (Desktop / Mobiel)'
                )}
              </span>
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {desktopInstallerUrl && (
              <button
                type="button"
                onClick={() => openExternalUrl(desktopInstallerUrl)}
                className="px-3 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  {tr(
                    language,
                    `Télécharger l'installateur (${detectedOs})`,
                    `Download installer (${detectedOs})`,
                    `Installatieprogramma downloaden (${detectedOs})`
                  )}
                </span>
              </button>
            )}
            {apkDownloadUrl && (
              <a
                href={apkDownloadUrl}
                download={`tot-stock-v${APP_VERSION}.apk`}
                className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 no-underline"
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>APK Android v{APP_VERSION}</span>
              </a>
            )}
            {!desktopInstallerUrl && !apkDownloadUrl && (
              <p className="text-[11px] text-slate-500">
                {tr(
                  language,
                  'Les binaires (.exe, .deb, .dmg, .apk) sont publiés sur la page des versions par votre administrateur.',
                  'Binaries (.exe, .deb, .dmg, .apk) are published on the releases page by your administrator.',
                  'Installatiebestanden (.exe, .deb, .dmg, .apk) worden gepubliceerd door uw beheerder.'
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 5. CRÉDITS & TECHNOLOGIES + 6. MENTIONS LÉGALES & CONFIDENTIALITÉ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex items-center gap-1.5 font-black text-slate-900 dark:text-white">
            <Code2 className="w-4 h-4 text-violet-600" />
            <span>
              {tr(
                language,
                'Crédits & Technologies',
                'Credits & Technologies',
                'Credits & Technologieën'
              )}
            </span>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
            React 19, TypeScript, Tailwind CSS, Supabase (PostgreSQL, Auth, Edge Functions, Vault, Storage), Lucide Icons, ZXing Barcode Scanner, Electron &amp; Capacitor.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex items-center gap-1.5 font-black text-slate-900 dark:text-white">
            <Scale className="w-4 h-4 text-teal-600" />
            <span>
              {tr(
                language,
                'Mentions légales, RGPD & Support',
                'Legal Notice, GDPR & Support',
                'Juridische kennisgeving, AVG & Support'
              )}
            </span>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
            {tr(
              language,
              'Éditeur : TOT Suite. Vos données métier sont hébergées exclusivement dans votre propre projet Supabase client (architecture BYOD). Conformité RGPD : journalisation minimisée (destinataires masqués) et secrets chiffrés côté serveur.',
              'Publisher: TOT Suite. Your business data is hosted exclusively in your own client Supabase project (BYOD architecture). GDPR compliant: minimized logs (masked recipients) and server-encrypted secrets.',
              'Uitgever: TOT Suite. Uw bedrijfsgegevens worden uitsluitend gehost in uw eigen Supabase-klantproject (BYOD-architectuur). AVG-conform: geminimaliseerde logboeken en versleutelde servergeheimen.'
            )}
          </p>
        </div>
      </div>

      {/* 7. JOURNAL D'AUDIT SERVEUR & TRANSFERTS VALIDÉS (v53 / v54) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
        <div className="flex items-center gap-1.5 font-black text-slate-900 dark:text-white">
          <ShieldCheck className="w-4 h-4 text-orange-600" />
          <span>
            {tr(
              language,
              `Journal d’audit serveur immuable, Transferts validés & Confidentialité (Schéma ${EXPECTED_SCHEMA_VERSION})`,
              `Immutable Server Audit Trail, Validated Transfers & Privacy (Schema ${EXPECTED_SCHEMA_VERSION})`,
              `Onveranderlijk Serverauditlogboek, Gevalideerde Overdrachten & Privacy (Schema ${EXPECTED_SCHEMA_VERSION})`
            )}
          </span>
        </div>
        <ul className="list-disc pl-5 space-y-1 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
          <li>
            <strong>{tr(language, 'Événements journalisés :', 'Logged events:', 'Gelogde gebeurtenissen:')}</strong>{' '}
            {tr(
              language,
              'modifications automatiques par triggers PostgreSQL sur 13 tables sensibles (utilisateurs, rôles, départements, chantiers, dépôts, articles, catégories, paramètres, licence, mailing), mouvements de stock, commandes, transferts validés à la réception (stk_transfers & stk_depot_holders), actions d’administration des comptes (Edge admin-users), connexions/déconnexions/échecs et exports CSV/PDF/e-mail.',
              'automatic PostgreSQL triggers on 13 sensitive tables (users, roles, departments, projects, depots, products, categories, settings, license, mailing), stock movements, orders, validated stock transfers (stk_transfers & stk_depot_holders), user admin actions (Edge admin-users), logins/logouts/failures, and CSV/PDF/email exports.',
              'automatische PostgreSQL-triggers op 13 gevoelige tabellen (gebruikers, rollen, afdelingen, projecten, depots, artikelen, categorieën, instellingen, licentie, mailing), voorraadbewegingen, bestellingen, gevalideerde overdrachten (stk_transfers & stk_depot_holders), gebruikersbeheer (Edge admin-users), aan-/afmeldingen en CSV/PDF/e-mail-exports.'
            )}
          </li>
          <li>
            <strong>{tr(language, 'Immuabilité & Rétention :', 'Immutability & Retention:', 'Onveranderlijkheid & Bewaring:')}</strong>{' '}
            {tr(
              language,
              'les tables core_audit_logs et core_login_logs sont protégées en ajout seul (tout UPDATE ou DELETE direct est bloqué par trigger). Seul le Super Administrateur (rôle 0) peut purger les entrées de plus de 90 jours via purge_audit_logs(p_older_than_days >= 90), et cette purge est elle-même journalisée.',
              'core_audit_logs and core_login_logs are strictly append-only (direct UPDATE or DELETE is blocked by trigger). Only the Super Administrator (role 0) can purge entries older than 90 days via purge_audit_logs(p_older_than_days >= 90), and the purge itself is logged.',
              'core_audit_logs en core_login_logs zijn strikt append-only (directe UPDATE of DELETE wordt geblokkeerd door een trigger). Alleen de Super Administrator (rol 0) kan items ouder dan 90 dagen wissen via purge_audit_logs(p_older_than_days >= 90), en deze actie wordt zelf gelogd.'
            )}
          </li>
          <li>
            <strong>{tr(language, 'Confidentialité des secrets :', 'Secret privacy:', 'Geheimhouding:')}</strong>{' '}
            {tr(
              language,
              'aucun mot de passe, code PIN, clé API, secret SMTP/Graph, jeton signé ou contenu brut de lignes exportées n’est jamais enregistré ; les champs sensibles sont systématiquement remplacés par « *** ».',
              'no password, PIN code, API key, SMTP/Graph secret, signed token, or raw exported row data is ever stored; sensitive fields are systematically masked as "***".',
              'geen wachtwoord, pincode, API-sleutel, SMTP/Graph-geheim, getekend token of ruwe geëxporteerde rijgegevens worden ooit opgeslagen; gevoelige velden worden systematisch gemaskeerd als "***".'
            )}
          </li>
        </ul>
      </div>
    </div>
  );
};
