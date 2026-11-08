import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  HelpCircle,
  KeyRound,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import {
  EDGE_FUNCTIONS,
  MASTER_EDGE_FUNCTIONS,
  ClientEdgeFunctionKey,
  EdgeFunctionPingItemResult,
  pingClientEdgeFunctions,
  pingSingleClientEdgeFunction,
} from '../constants/edgeFunctions';
import {
  EDGE_FN_BUNDLE_ADMIN_USERS,
  EDGE_FN_BUNDLE_MASTER_LICENSES,
  EDGE_FN_BUNDLE_PASSWORD_RESET,
  EDGE_FN_BUNDLE_SEND_REPORT_EMAIL,
  EDGE_FN_BUNDLE_SYNC_LICENSE,
} from '../constants/supabaseScripts';
import {
  getClientSupabase,
  normalizeSupabaseKey,
  normalizeSupabaseUrl,
  validateSupabaseAnonKey,
} from '../services/clientSupabase';
import { copyToClipboard, CLIPBOARD_COPY_FAILURE_LABEL } from '../services/clipboard';
import { tr } from '../i18n/dutchTranslator';
import { Language } from '../i18n/translations';
import { safeGetSensitiveItem } from '../services/localCrypto';

export interface EdgeFunctionsSetupPanelProps {
  language: Language;
  supabaseUrl?: string;
  supabaseKey?: string;
  isSuperAdmin?: boolean;
  settings?: Record<string, string>;
}

interface ClientFunctionCardItem {
  key: ClientEdgeFunctionKey;
  exactName: string;
  code: string;
  roleFr: string;
  roleEn: string;
  roleNl: string;
  secretsNoteFr: string;
  secretsNoteEn: string;
  secretsNoteNl: string;
}

export const CLIENT_EDGE_FUNCTION_ITEMS: ClientFunctionCardItem[] = [
  {
    key: 'syncLicense',
    exactName: EDGE_FUNCTIONS.syncLicense,
    code: EDGE_FN_BUNDLE_SYNC_LICENSE,
    roleFr:
      'Vérifie la signature cryptographique Ed25519 du jeton de licence et synchronise les quotas dans public.core_license_config.',
    roleEn:
      'Verifies the Ed25519 cryptographic signature of the license token and synchronizes quotas into public.core_license_config.',
    roleNl:
      'Verifieert de cryptografische Ed25519-handtekening van het licentietoken en synchroniseert quota in public.core_license_config.',
    secretsNoteFr: 'Secrets requis : TOT_LICENSE_PUBLIC_KEYS_JSON (ou LICENSE_PUBLIC_KEY_ED25519)',
    secretsNoteEn: 'Required secrets: TOT_LICENSE_PUBLIC_KEYS_JSON (or LICENSE_PUBLIC_KEY_ED25519)',
    secretsNoteNl: 'Vereiste secrets: TOT_LICENSE_PUBLIC_KEYS_JSON (of LICENSE_PUBLIC_KEY_ED25519)',
  },
  {
    key: 'adminUsers',
    exactName: EDGE_FUNCTIONS.adminUsers,
    code: EDGE_FN_BUNDLE_ADMIN_USERS,
    roleFr:
      'Crée, modifie, bloque ou supprime les comptes utilisateurs dans Supabase Auth et public.core_users.',
    roleEn:
      'Creates, updates, blocks, or deletes user accounts in Supabase Auth and public.core_users.',
    roleNl:
      'Maakt, wijzigt, blokkeert of verwijdert gebruikersaccounts in Supabase Auth en public.core_users.',
    secretsNoteFr: 'Secrets requis : aucun secret tiers (utilise SUPABASE_SERVICE_ROLE_KEY fourni par Supabase)',
    secretsNoteEn: 'Required secrets: no third-party secret (uses SUPABASE_SERVICE_ROLE_KEY provided by Supabase)',
    secretsNoteNl: 'Vereiste secrets: geen extern secret (gebruikt SUPABASE_SERVICE_ROLE_KEY van Supabase)',
  },
  {
    key: 'sendReportEmail',
    exactName: EDGE_FUNCTIONS.sendReportEmail,
    code: EDGE_FN_BUNDLE_SEND_REPORT_EMAIL,
    roleFr:
      'Envoie par e-mail les rapports d’audit, d’inventaire et de commandes via l’API transactionnelle Brevo.',
    roleEn:
      'Sends audit, inventory, and order reports by email via the Brevo transactional API.',
    roleNl:
      'Verzendt audit-, voorraad- en bestelrapporten per e-mail via de transactionele Brevo API.',
    secretsNoteFr: 'Secrets requis : BREVO_API_KEY (et optionnellement REPORT_FROM_EMAIL, REPORT_FROM_NAME)',
    secretsNoteEn: 'Required secrets: BREVO_API_KEY (and optionally REPORT_FROM_EMAIL, REPORT_FROM_NAME)',
    secretsNoteNl: 'Vereiste secrets: BREVO_API_KEY (en optioneel REPORT_FROM_EMAIL, REPORT_FROM_NAME)',
  },
  {
    key: 'passwordReset',
    exactName: EDGE_FUNCTIONS.passwordReset,
    code: EDGE_FN_BUNDLE_PASSWORD_RESET,
    roleFr:
      'Envoie un code de réinitialisation à 6 chiffres à usage unique (15 min) par e-mail et applique le nouveau mot de passe sans lien externe (compatible Web, APK et Desktop).',
    roleEn:
      'Sends a one-time 6-digit password reset code (15 min) by email and applies the new password without external redirect links (Web, APK, and Desktop compatible).',
    roleNl:
      'Verzendt een eenmalige 6-cijferige herstelcode (15 min) per e-mail en past het nieuwe wachtwoord toe zonder externe link (compatibel met Web, APK en Desktop).',
    secretsNoteFr:
      'Secrets requis : aucun secret tiers supplémentaire (utilise l’expéditeur configuré dans Paramètres > E-mails et SUPABASE_SERVICE_ROLE_KEY ; laisser « Verify JWT » activé)',
    secretsNoteEn:
      'Required secrets: no extra third-party secret (uses the sender configured in Settings > Emails and SUPABASE_SERVICE_ROLE_KEY; leave "Verify JWT" enabled)',
    secretsNoteNl:
      'Vereiste secrets: geen extra extern secret (gebruikt de afzender uit Instellingen > E-mails en SUPABASE_SERVICE_ROLE_KEY; laat "Verify JWT" ingeschakeld)',
  },
];

export const EdgeFunctionsSetupPanel: React.FC<EdgeFunctionsSetupPanelProps> = ({
  language,
  supabaseUrl,
  supabaseKey,
  isSuperAdmin = false,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState<boolean>(false);
  const [masterOpen, setMasterOpen] = useState<boolean>(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [testingKey, setTestingKey] = useState<ClientEdgeFunctionKey | 'all' | null>(null);
  const [pingResults, setPingResults] = useState<Partial<Record<ClientEdgeFunctionKey, EdgeFunctionPingItemResult>>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);

  const handleCopy = async (text: string, id: string) => {
    const ok = await copyToClipboard(text);
    if (!ok) {
      setGlobalError(CLIPBOARD_COPY_FAILURE_LABEL);
      return;
    }
    setGlobalError(null);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((prev) => (prev === id ? null : prev));
    }, 2000);
  };

  const resolveClient = (): { client: ReturnType<typeof getClientSupabase>; keyError?: string } => {
    const cleanUrl = normalizeSupabaseUrl(
      supabaseUrl || (typeof localStorage !== 'undefined' ? safeGetSensitiveItem('tqt_company_url') || '' : '')
    );
    const rawKey =
      supabaseKey || (typeof localStorage !== 'undefined' ? safeGetSensitiveItem('tqt_company_key') || '' : '');
    if (rawKey.trim()) {
      const keyCheck = validateSupabaseAnonKey(rawKey);
      if (!keyCheck.valid) {
        return { client: null, keyError: keyCheck.errorMessage };
      }
    }
    const cleanKey = normalizeSupabaseKey(rawKey);
    if (!cleanUrl || !cleanKey) return { client: null };
    return { client: getClientSupabase(cleanUrl, cleanKey) };
  };

  const handleTestSingle = async (key: ClientEdgeFunctionKey) => {
    setGlobalError(null);
    const { client, keyError } = resolveClient();
    if (keyError) {
      setGlobalError(keyError);
      return;
    }
    if (!client) {
      setGlobalError(
        tr(
          language,
          'Configurez d’abord l’URL et la clé Supabase pour tester les fonctions Edge.',
          'Configure the Supabase URL and key first to test Edge Functions.',
          'Configureer eerst de Supabase-URL en -sleutel om Edge Functions te testen.'
        )
      );
      return;
    }
    setTestingKey(key);
    try {
      const res = await pingSingleClientEdgeFunction(client, key);
      setPingResults((prev) => ({ ...prev, [key]: res }));
    } catch (err: any) {
      setPingResults((prev) => ({
        ...prev,
        [key]: {
          key,
          functionName: EDGE_FUNCTIONS[key],
          ok: false,
          state: 'error',
          detail: err?.message || 'Erreur inattendue',
        },
      }));
    } finally {
      setTestingKey(null);
    }
  };

  const handleTestAllThree = async () => {
    setGlobalError(null);
    const { client, keyError } = resolveClient();
    if (keyError) {
      setGlobalError(keyError);
      return;
    }
    if (!client) {
      setGlobalError(
        tr(
          language,
          'Configurez d’abord l’URL et la clé Supabase pour tester les 4 fonctions Edge.',
          'Configure the Supabase URL and key first to test all 4 Edge Functions.',
          'Configureer eerst de Supabase-URL en -sleutel om alle 4 Edge Functions te testen.'
        )
      );
      return;
    }
    setTestingKey('all');
    try {
      const report = await pingClientEdgeFunctions(client);
      const next: Partial<Record<ClientEdgeFunctionKey, EdgeFunctionPingItemResult>> = {};
      for (const r of report.items) {
        next[r.key] = r;
      }
      setPingResults(next);
    } catch (err: any) {
      setGlobalError(err?.message || 'Erreur lors du test des 4 fonctions Edge.');
    } finally {
      setTestingKey(null);
    }
  };

  const renderStatusBadge = (row?: EdgeFunctionPingItemResult) => {
    if (!row) return null;
    if (row.state === 'deployed') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 font-black text-[11px]">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{tr(language, 'déployée', 'deployed', 'gedeployed')}</span>
        </span>
      );
    }
    if (row.state === 'not_found') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-100 dark:bg-rose-950/70 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300 font-black text-[11px]">
          <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
          <span>
            {tr(
              language,
              'introuvable : créez-la avec le nom exact ci-dessus',
              'not found: create it with the exact name above',
              'niet gevonden: maak deze aan met de exacte naam hierboven'
            )}
          </span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 font-black text-[11px]">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
        <span>
          {tr(
            language,
            'déployée mais en erreur',
            'deployed but returned an error',
            'gedeployed maar met fout'
          )}
          {row.detail ? ` (${row.detail})` : ''}
        </span>
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* En-tête + bouton Tester les 3 fonctions */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Server className="w-4 h-4 sm:w-5 sm:h-5 text-orange-600" />
              <span>
                {tr(
                  language,
                  '4. Fonctions Edge Supabase (Fichiers uniques prêts à coller)',
                  '4. Supabase Edge Functions (Standalone single-file bundles)',
                  '4. Supabase Edge Functions (Kant-en-klare losse bestanden)'
                )}
              </span>
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {tr(
                language,
                'Chaque fonction ci-dessous est assemblée en un seul fichier TypeScript autonome (sans import ../_shared/) directement copiable dans le tableau de bord Supabase.',
                'Each function below is bundled into a single standalone TypeScript file (no ../_shared/ imports) ready to paste into the Supabase dashboard.',
                'Elke onderstaande functie is gebundeld in één zelfstandig TypeScript-bestand (zonder ../_shared/-imports), direct klaar om in het Supabase-dashboard te plakken.'
              )}
            </p>
          </div>

          <button
            type="button"
            disabled={testingKey !== null}
            onClick={handleTestAllThree}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-black text-xs cursor-pointer transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testingKey === 'all' ? 'animate-spin' : ''}`} />
            <span>
              {tr(
                language,
                'Tester les 4 fonctions',
                'Test all 4 functions',
                'Test alle 4 functies'
              )}
            </span>
          </button>
        </div>

        {globalError && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold">
            {globalError}
          </div>
        )}

        {/* Guide repliable en 4 étapes + secrets */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 overflow-hidden">
          <button
            type="button"
            onClick={() => setGuideOpen((v) => !v)}
            className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-left font-bold text-xs text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-orange-600 shrink-0" />
              <span>
                {tr(
                  language,
                  'Guide de déploiement en 4 étapes & Secrets Supabase requis',
                  '4-Step Deployment Guide & Required Supabase Secrets',
                  'Implementatiehandleiding in 4 stappen & Vereiste Supabase Secrets'
                )}
              </span>
            </span>
            {guideOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {guideOpen && (
            <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 space-y-3 text-xs text-slate-700 dark:text-slate-300">
              <div className="font-bold text-orange-600 dark:text-orange-400">
                Supabase → Edge Functions → Create a new function → coller le nom exact → coller le code → Deploy
              </div>
              <ol className="list-decimal pl-5 space-y-1">
                <li>
                  {tr(
                    language,
                    'Étape 1 : Ouvrez votre projet dans le tableau de bord Supabase → menu « Edge Functions » → cliquez sur « Create a new function » (Via Editor).',
                    'Step 1: Open your project in the Supabase Dashboard → "Edge Functions" menu → click "Create a new function" (Via Editor).',
                    'Stap 1: Open uw project in het Supabase Dashboard → menu "Edge Functions" → klik op "Create a new function" (Via Editor).'
                  )}
                </li>
                <li>
                  {tr(
                    language,
                    'Étape 2 : Cliquez sur « Copier le nom » ci-dessous et collez ce nom exact comme nom de la fonction.',
                    'Step 2: Click "Copy name" below and paste that exact name as the function name.',
                    'Stap 2: Klik hieronder op "Naam kopiëren" en plak deze exacte naam als functienaam.'
                  )}
                </li>
                <li>
                  {tr(
                    language,
                    'Étape 3 : Cliquez sur « Copier le code TypeScript complet », remplacez tout le contenu de index.ts dans l’éditeur Supabase, puis cliquez sur « Deploy ».',
                    'Step 3: Click "Copy full TypeScript code", replace the entire content of index.ts in the Supabase editor, then click "Deploy".',
                    'Stap 3: Klik op "Volledige TypeScript-code kopiëren", vervang de volledige inhoud van index.ts in de Supabase-editor en klik op "Deploy".'
                  )}
                </li>
                <li>
                  {tr(
                    language,
                    'Étape 4 : Configurez les secrets dans Supabase → Edge Functions → Secrets, puis cliquez sur « Tester les 3 fonctions ».',
                    'Step 4: Configure the secrets in Supabase → Edge Functions → Secrets, then click "Test all 3 functions".',
                    'Stap 4: Configureer de secrets in Supabase → Edge Functions → Secrets en klik vervolgens op "Test alle 3 functies".'
                  )}
                </li>
              </ol>

              <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-1.5">
                <div className="font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-orange-600" />
                  <span>
                    {tr(
                      language,
                      'Secrets nécessaires (Edge Functions → Secrets) :',
                      'Required Secrets (Edge Functions → Secrets):',
                      'Vereiste Secrets (Edge Functions → Secrets):'
                    )}
                  </span>
                </div>
                <ul className="list-disc pl-5 space-y-1 font-mono text-[11px]">
                  <li>
                    <strong>{EDGE_FUNCTIONS.syncLicense}</strong> :{' '}
                    <code>TOT_LICENSE_PUBLIC_KEYS_JSON</code>{' '}
                    {tr(
                      language,
                      '(ou LICENSE_PUBLIC_KEY_ED25519 pour la clé publique Ed25519 de vérification des licences)',
                      '(or LICENSE_PUBLIC_KEY_ED25519 for the Ed25519 license verification public key)',
                      '(of LICENSE_PUBLIC_KEY_ED25519 voor de publieke Ed25519-licentiesleutel)'
                    )}
                  </li>
                  <li>
                    <strong>{EDGE_FUNCTIONS.sendReportEmail}</strong> : <code>BREVO_API_KEY</code>{' '}
                    {tr(
                      language,
                      '(clé API Brevo pour l’envoi des rapports par e-mail)',
                      '(Brevo API key for sending email reports)',
                      '(Brevo API-sleutel voor het verzenden van e-mailrapporten)'
                    )}
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cartes des 3 fonctions Edge clientes */}
      <div className="space-y-3">
        {CLIENT_EDGE_FUNCTION_ITEMS.map((item) => {
          const pingRow = pingResults[item.key];
          const isPreviewOpen = previewKey === item.key;
          return (
            <div
              key={item.key}
              className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 shadow-xs"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300">
                      {tr(language, 'Nom exact Supabase', 'Exact Supabase Name', 'Exacte Supabase-naam')}
                    </span>
                    <code className="font-mono font-black text-xs sm:text-sm text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 select-all">
                      {item.exactName}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleCopy(item.exactName, `name_${item.key}`)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-200 font-bold text-[11px] cursor-pointer transition"
                    >
                      {copiedId === `name_${item.key}` ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span>{tr(language, 'Nom copié !', 'Name copied!', 'Naam gekopieerd!')}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>{tr(language, 'Copier le nom', 'Copy name', 'Naam kopiëren')}</span>
                        </>
                      )}
                    </button>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {tr(language, item.roleFr, item.roleEn, item.roleNl)}
                  </p>
                  <p className="text-[11px] font-mono text-slate-400">
                    {tr(language, item.secretsNoteFr, item.secretsNoteEn, item.secretsNoteNl)}
                  </p>
                </div>

                <div className="flex items-center gap-2">{renderStatusBadge(pingRow)}</div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleCopy(item.code, `code_${item.key}`)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-orange-600 text-white font-extrabold text-xs cursor-pointer transition shadow-xs"
                >
                  {copiedId === `code_${item.key}` ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>
                        {tr(
                          language,
                          'Code TypeScript copié !',
                          'TypeScript code copied!',
                          'TypeScript-code gekopieerd!'
                        )}
                      </span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>
                        {tr(
                          language,
                          'Copier le code TypeScript complet',
                          'Copy full TypeScript code',
                          'Volledige TypeScript-code kopiëren'
                        )}
                      </span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={testingKey !== null}
                  onClick={() => handleTestSingle(item.key)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs cursor-pointer transition disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 text-orange-600 ${testingKey === item.key ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {tr(
                      language,
                      'Tester cette fonction',
                      'Test this function',
                      'Test deze functie'
                    )}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setPreviewKey(isPreviewOpen ? null : item.key)}
                  className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl text-slate-500 hover:text-slate-800 dark:hover:text-white font-bold text-xs cursor-pointer"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>
                    {isPreviewOpen
                      ? tr(language, 'Masquer le code', 'Hide code', 'Code verbergen')
                      : tr(language, 'Aperçu du code', 'Preview code', 'Code bekijken')}
                  </span>
                </button>
              </div>

              {isPreviewOpen && (
                <pre className="p-3 rounded-xl bg-slate-950 text-slate-100 font-mono text-[11px] overflow-auto max-h-72 leading-relaxed border border-slate-800">
                  {item.code}
                </pre>
              )}
            </div>
          );
        })}
      </div>

      {/* Bloc repliable Super Admin (rôle 0) : Fonction maître (éditeur uniquement) */}
      {isSuperAdmin && (
        <div className="rounded-2xl border border-amber-300 dark:border-amber-800/70 bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden">
          <button
            type="button"
            onClick={() => setMasterOpen((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left font-black text-xs text-amber-900 dark:text-amber-200 hover:bg-amber-100/60 dark:hover:bg-amber-950/40 transition cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>
                {tr(
                  language,
                  'Fonction maître (éditeur uniquement)',
                  'Master function (publisher only)',
                  'Masterfunctie (alleen uitgever)'
                )}{' '}
                — <code className="font-mono">{MASTER_EDGE_FUNCTIONS.licenses}</code>
              </span>
            </span>
            {masterOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {masterOpen && (
            <div className="p-4 border-t border-amber-200 dark:border-amber-800/60 space-y-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono font-black text-xs sm:text-sm text-amber-950 dark:text-amber-100 bg-white dark:bg-slate-900 px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-700 select-all">
                  {MASTER_EDGE_FUNCTIONS.licenses}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy(MASTER_EDGE_FUNCTIONS.licenses, 'name_master')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 font-bold text-[11px] cursor-pointer"
                >
                  {copiedId === 'name_master' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{tr(language, 'Nom copié !', 'Name copied!', 'Naam gekopieerd!')}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>{tr(language, 'Copier le nom', 'Copy name', 'Naam kopiëren')}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleCopy(EDGE_FN_BUNDLE_MASTER_LICENSES, 'code_master')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs cursor-pointer transition"
                >
                  {copiedId === 'code_master' ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>
                        {tr(
                          language,
                          'Code maître copié !',
                          'Master code copied!',
                          'Mastercode gekopieerd!'
                        )}
                      </span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>
                        {tr(
                          language,
                          'Copier le code TypeScript complet',
                          'Copy full TypeScript code',
                          'Volledige TypeScript-code kopiëren'
                        )}
                      </span>
                    </>
                  )}
                </button>
              </div>

              <p className="text-[11px] text-amber-800 dark:text-amber-300">
                {tr(
                  language,
                  'Réservé au serveur central de l’éditeur : émet et signe les jetons Ed25519 (clé privée LICENSE_PRIVATE_KEY_ED25519_PKCS8) pour les bases clientes.',
                  'Reserved for the publisher central server: issues and signs Ed25519 tokens (private key LICENSE_PRIVATE_KEY_ED25519_PKCS8) for client databases.',
                  'Gereserveerd voor de centrale uitgeversserver: geeft Ed25519-tokens uit en ondertekent deze (privésleutel LICENSE_PRIVATE_KEY_ED25519_PKCS8) voor klantdatabases.'
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
