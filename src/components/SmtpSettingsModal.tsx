import React, { useState, useEffect, useCallback } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { SearchableSelect } from './SearchableSelect';
import {
  X,
  Sliders,
  CheckCircle,
  AlertTriangle,
  Send,
  HelpCircle,
  ShieldCheck,
  Server,
  Loader2,
  Lock,
  Plus,
  Trash2,
  RefreshCw,
  Mail,
  History,
  Layers,
  Check,
  Edit3,
} from 'lucide-react';
import { getClientSupabase } from '../services/clientSupabase';
import { SUITE_MAIL_APPLICATIONS, CURRENT_MAIL_APP_CODE } from '../constants/tables';
import {
  MAIL_PROVIDER_PRESETS,
  MailAccountRecord,
  MailEncryptionKind,
  MailLogRecord,
  MailPresetId,
  MailProviderKind,
  MailSenderRecord,
  canUserManageMailSettings,
  checkSenderDomainMismatch,
  deleteMailAccountById,
  evaluateMsGraphSecretExpiry,
  fetchMailAccountsWithSecretStatus,
  fetchMailLogEntries,
  fetchSuiteMailSenders,
  getPresetById,
  isValidEmailAddress,
  isValidGuid,
  isValidMsGraphTenant,
  purgeMailLogsOlderThan,
  requiresVerifiedSenderReminder,
  saveMailAccountMetadata,
  saveMailAccountSecretWriteOnly,
  saveSuiteMailSender,
  sendTestEmailRequest,
} from '../services/mailingService';
import { safeGetSensitiveItem } from '../services/localCrypto';

export interface EmailSettingsPanelProps {
  embedded?: boolean;
  onClose?: () => void;
}

export const EmailSettingsPanel: React.FC<EmailSettingsPanelProps> = ({
  embedded = false,
  onClose,
}) => {
  const {
    language,
    t,
    settings,
    updateSetting,
    currentUser,
    userHasPermission,
  } = useApp();

  const isAdmin = canUserManageMailSettings(currentUser, userHasPermission);

  const [activeTab, setActiveTab] = useState<'accounts' | 'senders' | 'logs'>('accounts');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
    statusCode?: number;
  } | null>(null);

  // Onglet 1 : Comptes d'envoi
  const [accounts, setAccounts] = useState<MailAccountRecord[]>([]);
  const [editingAccountId, setEditingAccountId] = useState<string | undefined>(undefined);
  const [selectedPreset, setSelectedPreset] = useState<MailPresetId>('brevo');
  const [accountName, setAccountName] = useState('Brevo Principal');
  const [provider, setProvider] = useState<MailProviderKind>('brevo');
  const [host, setHost] = useState('');
  const [port, setPort] = useState<number>(587);
  const [encryption, setEncryption] = useState<MailEncryptionKind>('starttls');
  const [username, setUsername] = useState('');
  const [mailgunDomain, setMailgunDomain] = useState('');
  const [mailgunRegion, setMailgunRegion] = useState<'eu' | 'us'>('eu');
  // Champs Microsoft 365 (Graph)
  const [msgraphTenantId, setMsgraphTenantId] = useState('');
  const [msgraphClientId, setMsgraphClientId] = useState('');
  const [msgraphSecretExpiresAt, setMsgraphSecretExpiresAt] = useState('');
  const [isActiveAccount, setIsActiveAccount] = useState(true);
  // Champ secret en écriture seule : jamais pré-rempli depuis la base
  const [secretInput, setSecretInput] = useState('');
  const [editingHasExistingSecret, setEditingHasExistingSecret] = useState(false);
  const [isSavingAccount, setIsSavingAccount] = useState(false);

  // Test d'envoi
  const [testRecipient, setTestRecipient] = useState(currentUser?.email || '');
  const [testAppCode, setTestAppCode] = useState<string>(CURRENT_MAIL_APP_CODE);
  const [isSendingTest, setIsSendingTest] = useState(false);

  // Onglet 2 : Expéditeurs par application
  const [senders, setSenders] = useState<MailSenderRecord[]>(() =>
    SUITE_MAIL_APPLICATIONS.map((app) => ({
      app_code: app.code,
      from_name: app.defaultFromName,
      from_email:
        app.code === CURRENT_MAIL_APP_CODE
          ? settings?.smtp_from_email || settings?.smtp_from || ''
          : '',
      reply_to: '',
      account_id: null,
    }))
  );
  const [savingSenderCode, setSavingSenderCode] = useState<string | null>(null);

  // Onglet 3 : Journal
  const [logs, setLogs] = useState<MailLogRecord[]>([]);
  const [logFilterApp, setLogFilterApp] = useState<string>('all');
  const [logFilterStatus, setLogFilterStatus] = useState<string>('all');
  const [isPurgingLogs, setIsPurgingLogs] = useState(false);

  const getSupabaseClient = useCallback(() => {
    const supabaseUrl = (safeGetSensitiveItem('tot_inv_supabase_url') || '').trim();
    const supabaseKey = (safeGetSensitiveItem('tot_inv_supabase_key') || '').trim();
    return getClientSupabase(supabaseUrl, supabaseKey);
  }, []);

  // Nettoyage de sécurité des anciens identifiants éventuels dans localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('tot_inv_smtp_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.pass || parsed.password || parsed.user || parsed.apiKey || parsed.secret) {
          delete parsed.pass;
          delete parsed.password;
          delete parsed.user;
          delete parsed.apiKey;
          delete parsed.secret;
          localStorage.setItem('tot_inv_smtp_config', JSON.stringify(parsed));
        }
      }
    } catch {
      // Ignorer
    }
  }, []);

  const applyPresetDefaults = useCallback(
    (presetId: MailPresetId, preserveCustomName = false) => {
      const preset = getPresetById(presetId);
      setSelectedPreset(preset.id);
      setProvider(preset.provider);
      if (!preserveCustomName) {
        const shortName =
          language === 'en'
            ? preset.labelEn.split(' (')[0]
            : language === 'nl'
            ? preset.labelNl.split(' (')[0]
            : preset.labelFr.split(' (')[0];
        setAccountName(shortName);
      }
      setHost(preset.defaultHost || '');
      setPort(preset.defaultPort || 587);
      setEncryption(preset.defaultEncryption || 'starttls');
    },
    [language]
  );

  const selectAccountForEdit = useCallback((acc: MailAccountRecord) => {
    setEditingAccountId(acc.id);
    const presetDef = getPresetById(acc.preset, acc.provider);
    setSelectedPreset(presetDef.id);
    setAccountName(acc.name || presetDef.labelFr.split(' (')[0]);
    setProvider(acc.provider);
    setHost(acc.host || presetDef.defaultHost || '');
    setPort(Number(acc.port || presetDef.defaultPort || 587));
    setEncryption((acc.encryption as MailEncryptionKind) || presetDef.defaultEncryption || 'starttls');
    setUsername(acc.username || '');
    setMailgunDomain(String(acc.extra?.domain || ''));
    setMailgunRegion(acc.extra?.region === 'us' ? 'us' : 'eu');
    setMsgraphTenantId(String(acc.extra?.tenant_id || ''));
    setMsgraphClientId(String(acc.extra?.client_id || ''));
    setMsgraphSecretExpiresAt(String(acc.extra?.secret_expires_at || ''));
    setIsActiveAccount(Boolean(acc.is_active));
    setEditingHasExistingSecret(Boolean(acc.has_secret));
    // Champ secret toujours vide (écriture seule)
    setSecretInput('');
  }, []);

  const resetAccountFormToNew = useCallback(() => {
    setEditingAccountId(undefined);
    setEditingHasExistingSecret(false);
    setSecretInput('');
    setUsername('');
    setMailgunDomain('');
    setMailgunRegion('eu');
    setMsgraphTenantId('');
    setMsgraphClientId('');
    setMsgraphSecretExpiresAt('');
    setIsActiveAccount(accounts.length === 0);
    applyPresetDefaults('brevo', false);
  }, [accounts.length, applyPresetDefaults]);

  const loadAllMailingData = useCallback(async () => {
    const client = getSupabaseClient();
    if (!client) return;
    setLoading(true);
    try {
      const [loadedAccounts, loadedSenders, loadedLogs] = await Promise.all([
        fetchMailAccountsWithSecretStatus(client),
        fetchSuiteMailSenders(client),
        fetchMailLogEntries(client, {
          appCode: logFilterApp,
          status: logFilterStatus,
          limit: 100,
        }),
      ]);
      setAccounts(loadedAccounts);
      setSenders(loadedSenders);
      setLogs(loadedLogs);

      if (loadedAccounts.length > 0 && !editingAccountId) {
        const activeOrFirst =
          loadedAccounts.find((a) => a.is_active) || loadedAccounts[0];
        selectAccountForEdit(activeOrFirst);
      }
    } finally {
      setLoading(false);
    }
  }, [editingAccountId, getSupabaseClient, logFilterApp, logFilterStatus, selectAccountForEdit]);

  useEffect(() => {
    loadAllMailingData();
  }, [loadAllMailingData]);

  const refreshLogs = async (appFilter = logFilterApp, statusFilter = logFilterStatus) => {
    const client = getSupabaseClient();
    if (!client) return;
    const loadedLogs = await fetchMailLogEntries(client, {
      appCode: appFilter,
      status: statusFilter,
      limit: 100,
    });
    setLogs(loadedLogs);
  };

  const currentPreset = getPresetById(selectedPreset, provider);

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    if (!accountName.trim()) {
      setMsg({
        type: 'error',
        text: tr(
          language,
          'Veuillez saisir un nom pour ce compte d’envoi.',
          'Please enter a name for this mail account.',
          'Voer een naam in voor dit verzendaccount.'
        ),
      });
      return;
    }

    if (provider === 'smtp' && Number(port) === 25) {
      setMsg({
        type: 'error',
        text: tr(
          language,
          'Le port SMTP 25 n’est pas pris en charge par les fonctions Edge (bloqué contre le spam). Utilisez le port 587 (STARTTLS) ou 465 (SSL/TLS).',
          'SMTP port 25 is not supported by Edge Functions. Please use port 587 (STARTTLS) or 465 (SSL/TLS).',
          'SMTP-poort 25 wordt niet ondersteund door Edge Functions. Gebruik poort 587 (STARTTLS) of 465 (SSL/TLS).'
        ),
      });
      return;
    }

    if (provider === 'smtp' && !host.trim()) {
      setMsg({
        type: 'error',
        text: tr(
          language,
          'Veuillez renseigner l’hôte du serveur SMTP (ex. smtp.gmail.com, ssl0.ovh.net).',
          'Please enter the SMTP server host (e.g. smtp.gmail.com, ssl0.ovh.net).',
          'Vul de host van de SMTP-server in (bijv. smtp.gmail.com, ssl0.ovh.net).'
        ),
      });
      return;
    }

    if (provider === 'mailgun' && !mailgunDomain.trim()) {
      setMsg({
        type: 'error',
        text: tr(
          language,
          'Veuillez renseigner le domaine d’envoi Mailgun (ex. mg.votre-domaine.fr).',
          'Please enter the Mailgun sending domain (e.g. mg.your-domain.com).',
          'Vul het Mailgun-verzenddomein in (bijv. mg.uw-domein.be).'
        ),
      });
      return;
    }

    if (provider === 'msgraph') {
      if (!isValidMsGraphTenant(msgraphTenantId)) {
        setMsg({
          type: 'error',
          text: tr(
            language,
            'Veuillez saisir un ID de locataire (Tenant ID) Microsoft 365 valide (GUID ou domaine ex. contoso.onmicrosoft.com).',
            'Please enter a valid Microsoft 365 Tenant ID (GUID or domain e.g. contoso.onmicrosoft.com).',
            'Voer een geldige Microsoft 365 Tenant ID in (GUID of domein bijv. contoso.onmicrosoft.com).'
          ),
        });
        return;
      }
      if (!isValidGuid(msgraphClientId)) {
        setMsg({
          type: 'error',
          text: tr(
            language,
            "Veuillez saisir un ID d'application (Client ID) Microsoft Entra au format GUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).",
            'Please enter a Microsoft Entra Application (Client) ID in GUID format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).',
            'Voer een Microsoft Entra Applicatie-ID (Client ID) in GUID-formaat in (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).'
          ),
        });
        return;
      }
    }

    const client = getSupabaseClient();
    if (!client) {
      setMsg({
        type: 'error',
        text: tr(
          language,
          'Connexion Supabase requise pour enregistrer les comptes d’envoi en base (exécutez le script 14_mailing.sql).',
          'Supabase connection required to save mail accounts in database (run script 14_mailing.sql).',
          'Supabase-verbinding vereist om verzendaccounts op te slaan (voer script 14_mailing.sql uit).'
        ),
      });
      return;
    }

    setIsSavingAccount(true);
    setMsg(null);
    try {
      const extra: Record<string, any> = {};
      if (provider === 'mailgun') {
        extra.domain = mailgunDomain.trim();
        extra.region = mailgunRegion;
      } else if (provider === 'msgraph') {
        extra.tenant_id = msgraphTenantId.trim();
        extra.client_id = msgraphClientId.trim();
        if (msgraphSecretExpiresAt.trim()) {
          extra.secret_expires_at = msgraphSecretExpiresAt.trim();
        }
      }

      const metaRes = await saveMailAccountMetadata(client, {
        id: editingAccountId,
        name: accountName.trim(),
        provider,
        preset: selectedPreset,
        host: provider === 'smtp' ? host.trim() : provider === 'mailgun' ? mailgunDomain.trim() : null,
        port: provider === 'smtp' ? Number(port) : null,
        encryption: provider === 'smtp' ? encryption : null,
        username: currentPreset.requiresUsername ? username.trim() : null,
        extra,
        is_active: isActiveAccount,
      });

      if (!metaRes.ok || !metaRes.account) {
        setMsg({
          type: 'error',
          text: metaRes.error || 'Erreur lors de la sauvegarde du compte.',
        });
        return;
      }

      const savedId = metaRes.account.id;
      let secretSavedNow = false;

      if (secretInput.trim()) {
        const secretRes = await saveMailAccountSecretWriteOnly(
          client,
          savedId,
          secretInput.trim()
        );
        // Vider immédiatement le champ secret en mémoire
        setSecretInput('');
        if (!secretRes.ok) {
          setMsg({
            type: 'error',
            text:
              secretRes.error ||
              tr(
                language,
                'Le compte a été enregistré mais le stockage du secret dans Vault a échoué.',
                'Account saved, but storing secret in Vault failed.',
                'Account opgeslagen, maar opslaan van geheim in Vault is mislukt.'
              ),
          });
          return;
        }
        secretSavedNow = true;
      }

      await loadAllMailingData();
      setEditingAccountId(savedId);
      if (secretSavedNow) {
        setEditingHasExistingSecret(true);
      }

      setMsg({
        type: 'success',
        text: secretSavedNow
          ? tr(
              language,
              'Compte d’envoi et secret chiffré (Supabase Vault) enregistrés avec succès.',
              'Mail account and encrypted secret (Supabase Vault) saved successfully.',
              'Verzendaccount en versleuteld geheim (Supabase Vault) succesvol opgeslagen.'
            )
          : tr(
              language,
              'Paramètres du compte d’envoi mis à jour (secret existant conservé).',
              'Mail account settings updated (existing secret kept).',
              'Instellingen van verzendaccount bijgewerkt (bestaand geheim behouden).'
            ),
      });
    } finally {
      setIsSavingAccount(false);
    }
  };

  const handleDeleteAccount = async (acc: MailAccountRecord) => {
    const client = getSupabaseClient();
    if (!client) return;
    const res = await deleteMailAccountById(client, acc.id);
    if (!res.ok) {
      setMsg({ type: 'error', text: res.error || 'Impossible de supprimer ce compte.' });
      return;
    }
    if (editingAccountId === acc.id) {
      resetAccountFormToNew();
    }
    await loadAllMailingData();
    setMsg({
      type: 'info',
      text: tr(
        language,
        `Compte "${acc.name}" supprimé.`,
        `Account "${acc.name}" deleted.`,
        `Account "${acc.name}" verwijderd.`
      ),
    });
  };

  const handleSendTestEmail = async () => {
    const target = (testRecipient || currentUser?.email || '').trim();
    if (!isValidEmailAddress(target)) {
      setMsg({
        type: 'error',
        text: tr(
          language,
          'Veuillez saisir une adresse e-mail destinataire valide pour le test.',
          'Please enter a valid recipient email address for the test.',
          'Voer een geldig e-mailadres van de ontvanger in voor de test.'
        ),
      });
      return;
    }

    const client = getSupabaseClient();
    setIsSendingTest(true);
    setMsg(null);
    try {
      const res = await sendTestEmailRequest(client, {
        to: target,
        appCode: testAppCode,
      });
      if (res.ok) {
        setMsg({
          type: 'success',
          text: res.message,
        });
        await refreshLogs();
      } else {
        setMsg({
          type: 'error',
          text: res.message,
          statusCode: res.statusCode,
        });
        await refreshLogs();
      }
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleUpdateSenderRow = (
    appCode: string,
    field: keyof MailSenderRecord,
    value: string | null
  ) => {
    setSenders((prev) =>
      prev.map((row) =>
        row.app_code === appCode ? { ...row, [field]: value } : row
      )
    );
  };

  const handleSaveSenderRow = async (row: MailSenderRecord) => {
    if (row.from_email && !isValidEmailAddress(row.from_email)) {
      setMsg({
        type: 'error',
        text: tr(
          language,
          `Adresse d'expéditeur invalide pour ${row.app_code.toUpperCase()} : "${row.from_email}".`,
          `Invalid sender email address for ${row.app_code.toUpperCase()}: "${row.from_email}".`,
          `Ongeldig afzenderadres voor ${row.app_code.toUpperCase()}: "${row.from_email}".`
        ),
      });
      return;
    }
    if (row.reply_to && !isValidEmailAddress(row.reply_to)) {
      setMsg({
        type: 'error',
        text: tr(
          language,
          `Adresse de réponse (Reply-To) invalide pour ${row.app_code.toUpperCase()} : "${row.reply_to}".`,
          `Invalid Reply-To email address for ${row.app_code.toUpperCase()}: "${row.reply_to}".`,
          `Ongeldig antwoordadres (Reply-To) voor ${row.app_code.toUpperCase()}: "${row.reply_to}".`
        ),
      });
      return;
    }

    // Garder synchronisé le cache non sensible local pour l'application courante (stk)
    if (row.app_code === CURRENT_MAIL_APP_CODE) {
      const safeLocal = {
        from_name: row.from_name.trim(),
        from_email: row.from_email.trim(),
      };
      try {
        localStorage.setItem('tot_inv_smtp_config', JSON.stringify(safeLocal));
      } catch {
        // Ignorer
      }
      if (updateSetting) {
        updateSetting('smtp_from', safeLocal.from_email);
        updateSetting('smtp_from_email', safeLocal.from_email);
        updateSetting('smtp_from_name', safeLocal.from_name);
      }
    }

    const client = getSupabaseClient();
    if (!client) {
      setMsg({
        type: 'info',
        text: tr(
          language,
          'Expéditeur local enregistré (connectez Supabase pour synchroniser core_mail_senders).',
          'Local sender saved (connect Supabase to sync core_mail_senders).',
          'Lokale afzender opgeslagen (verbind Supabase om core_mail_senders te synchroniseren).'
        ),
      });
      return;
    }

    setSavingSenderCode(row.app_code);
    setMsg(null);
    try {
      const res = await saveSuiteMailSender(client, row);
      if (!res.ok) {
        setMsg({ type: 'error', text: res.error || 'Erreur lors de la sauvegarde.' });
      } else {
        setMsg({
          type: 'success',
          text: tr(
            language,
            `Expéditeur de l'application ${row.app_code.toUpperCase()} enregistré.`,
            `Sender for application ${row.app_code.toUpperCase()} saved.`,
            `Afzender voor applicatie ${row.app_code.toUpperCase()} opgeslagen.`
          ),
        });
      }
    } finally {
      setSavingSenderCode(null);
    }
  };

  const handlePurgeLogs = async () => {
    const client = getSupabaseClient();
    if (!client) return;
    setIsPurgingLogs(true);
    setMsg(null);
    try {
      const res = await purgeMailLogsOlderThan(client, 90);
      if (!res.ok) {
        setMsg({ type: 'error', text: res.error || 'Échec de la purge du journal.' });
      } else {
        await refreshLogs();
        setMsg({
          type: 'success',
          text: tr(
            language,
            `Purge effectuée (> 90 jours) : ${res.deletedCount ?? 0} entrée(s) supprimée(s).`,
            `Purge completed (> 90 days): ${res.deletedCount ?? 0} entry(ies) deleted.`,
            `Opschoning voltooid (> 90 dagen): ${res.deletedCount ?? 0} regel(s) verwijderd.`
          ),
        });
      }
    } finally {
      setIsPurgingLogs(false);
    }
  };

  const defaultActiveAccount =
    accounts.find((a) => a.is_active) || accounts[0] || null;

  if (!isAdmin) {
    return (
      <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2.5">
        <Lock className="w-4 h-4 shrink-0 text-amber-600" />
        <span>
          {tr(
            language,
            "Accès réservé aux administrateurs (rôle 0, 1 ou permission perm_config_email).",
            'Access restricted to administrators (role 0, 1 or perm_config_email permission).',
            'Toegang voorbehouden aan beheerders (rol 0, 1 of perm_config_email).'
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-4 text-xs text-slate-800 dark:text-slate-100">
      {/* En-tête si modal ou panneau */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-cyan-100 dark:bg-cyan-950/60 text-cyan-600 flex items-center justify-center font-bold shrink-0">
            <Sliders className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
              <span>
                {tr(
                  language,
                  'E-mails Multi-Fournisseurs & Expéditeurs par Application',
                  'Multi-Provider Emails & Per-Application Senders',
                  'Multi-provider e-mails & afzenders per applicatie'
                )}
              </span>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                {tr(
                  language,
                  'Secrets Supabase Vault',
                  'Supabase Vault Secrets',
                  'Supabase Vault-geheimen'
                )}
              </span>
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {tr(
                language,
                'Base partagée TOT Suite (stk, hab, rpt, tools) — aucune clé API ni mot de passe n’est renvoyé au navigateur',
                'Shared TOT Suite database (stk, hab, rpt, tools) — no API key or password is ever returned to the browser',
                'Gedeelde TOT Suite-database (stk, hab, rpt, tools) — geen API-sleutel of wachtwoord wordt ooit naar de browser gestuurd'
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => loadAllMailingData()}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition cursor-pointer"
            title={tr(language, 'Actualiser', 'Refresh', 'Vernieuwen')}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {!embedded && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition cursor-pointer"
              title={t('common_close')}
            >
              <X className="w-4 h-4 stroke-[2.5]" />
            </button>
          )}
        </div>
      </div>

      {/* Barre des 3 onglets */}
      <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
        <button
          type="button"
          onClick={() => setActiveTab('accounts')}
          className={`py-2 px-3 rounded-xl font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer ${
            activeTab === 'accounts'
              ? 'bg-white dark:bg-slate-900 text-cyan-600 dark:text-cyan-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Server className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            {tr(language, "1. Comptes d'envoi", '1. Mail Accounts', '1. Verzendaccounts')}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('senders')}
          className={`py-2 px-3 rounded-xl font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer ${
            activeTab === 'senders'
              ? 'bg-white dark:bg-slate-900 text-cyan-600 dark:text-cyan-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Layers className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            {tr(
              language,
              '2. Expéditeurs par application',
              '2. Senders per Application',
              '2. Afzenders per applicatie'
            )}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('logs');
            refreshLogs();
          }}
          className={`py-2 px-3 rounded-xl font-extrabold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer ${
            activeTab === 'logs'
              ? 'bg-white dark:bg-slate-900 text-cyan-600 dark:text-cyan-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <History className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            {tr(language, '3. Journal', '3. Mail Log', '3. Verzendlogboek')}
          </span>
        </button>
      </div>

      {/* Message de retour */}
      {msg && (
        <div
          className={`p-3 rounded-2xl text-xs font-bold flex items-center justify-between gap-2 border ${
            msg.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
              : msg.type === 'info'
              ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {msg.type === 'success' ? (
              <CheckCircle className="w-4 h-4 shrink-0" />
            ) : msg.type === 'info' ? (
              <HelpCircle className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span className="break-words">{msg.text}</span>
          </div>
          {typeof msg.statusCode === 'number' && (
            <span className="px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-900/60 text-[10px] font-mono font-extrabold shrink-0">
              HTTP {msg.statusCode}
            </span>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* ONGLET 1 : COMPTES D'ENVOI (core_mail_accounts)                        */}
      {/* ===================================================================== */}
      {activeTab === 'accounts' && (
        <div className="space-y-4">
          {/* Liste des comptes existants */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-extrabold text-slate-900 dark:text-white">
                {tr(
                  language,
                  'Comptes d’envoi enregistrés',
                  'Configured Mail Accounts',
                  'Ingestelde verzendaccounts'
                )}
              </span>
              <button
                type="button"
                onClick={resetAccountFormToNew}
                className="px-2.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>
                  {tr(language, 'Nouveau compte', 'New account', 'Nieuw account')}
                </span>
              </button>
            </div>

            {accounts.length === 0 ? (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {tr(
                  language,
                  "Aucun compte d'envoi configuré dans core_mail_accounts. Créez un compte ci-dessous (Brevo, Resend, SendGrid, Mailgun, Postmark, Mailjet, Microsoft 365 Graph ou SMTP).",
                  'No mail account configured in core_mail_accounts. Create an account below (Brevo, Resend, SendGrid, Mailgun, Postmark, Mailjet, Microsoft 365 Graph, or SMTP).',
                  'Geen verzendaccount ingesteld in core_mail_accounts. Maak hieronder een account aan.'
                )}
              </p>
            ) : (
              <div className="space-y-2">
                {accounts.map((acc) => (
                  <div
                    key={acc.id}
                    className={`p-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 ${
                      editingAccountId === acc.id
                        ? 'border-cyan-500 bg-cyan-50/60 dark:bg-cyan-950/30'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-slate-900 dark:text-white">
                          {acc.name}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono uppercase font-bold text-slate-700 dark:text-slate-300">
                          {acc.preset || acc.provider}
                        </span>
                        {acc.is_active && (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                            {tr(language, 'Actif par défaut', 'Default active', 'Standaard actief')}
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            acc.has_secret
                              ? 'bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300'
                              : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {acc.has_secret
                            ? tr(
                                language,
                                'Secret enregistré ✓ (●●●●●)',
                                'Secret saved ✓ (●●●●●)',
                                'Geheim opgeslagen ✓ (●●●●●)'
                              )
                            : tr(
                                language,
                                'Secret manquant',
                                'Secret missing',
                                'Geheim ontbreekt'
                              )}
                        </span>
                      </div>
                      {acc.host && (
                        <p className="text-[11px] text-slate-500 font-mono">
                          {acc.host}
                          {acc.port ? `:${acc.port}` : ''} ({acc.encryption || 'tls'})
                        </p>
                      )}
                      {acc.provider === 'msgraph' && acc.extra?.tenant_id && (
                        <p className="text-[11px] text-slate-500 font-mono">
                          Tenant: {String(acc.extra.tenant_id)} · Client: {String(acc.extra.client_id || '').slice(0, 8)}…
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => selectAccountForEdit(acc)}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>{tr(language, 'Modifier', 'Edit', 'Bewerken')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteAccount(acc)}
                        className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 cursor-pointer"
                        title={tr(language, 'Supprimer', 'Delete', 'Verwijderen')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Formulaire de configuration du compte */}
          <form
            onSubmit={handleSaveAccount}
            className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-3.5"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-cyan-600" />
                <span>
                  {editingAccountId
                    ? tr(
                        language,
                        'Modifier le compte d’envoi',
                        'Edit Mail Account',
                        'Verzendaccount bewerken'
                      )
                    : tr(
                        language,
                        'Ajouter un compte d’envoi',
                        'Add Mail Account',
                        'Verzendaccount toevoegen'
                      )}
                </span>
              </h3>
              <label className="flex items-center gap-1.5 text-[11px] font-bold cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActiveAccount}
                  onChange={(e) => setIsActiveAccount(e.target.checked)}
                  className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                />
                <span>
                  {tr(
                    language,
                    'Compte actif par défaut de la base',
                    'Default active account for database',
                    'Standaard actief account voor database'
                  )}
                </span>
              </label>
            </div>

            {/* Sélecteur de fournisseur / modèle pré-rempli */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {tr(
                    language,
                    'Fournisseur / Modèle pré-rempli',
                    'Provider / Preset Template',
                    'Provider / Vooringesteld sjabloon'
                  )}
                </label>
                <SearchableSelect
                  value={selectedPreset}
                  onChange={(val) =>
                    applyPresetDefaults(val as MailPresetId, Boolean(editingAccountId))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-bold"
                >
                  <optgroup
                    label={tr(
                      language,
                      'Services transactionnels & OAuth2 (API HTTP — recommandés)',
                      'Transactional & OAuth2 Services (HTTP API — recommended)',
                      'Transactionele & OAuth2-diensten (HTTP API — aanbevolen)'
                    )}
                  >
                    {MAIL_PROVIDER_PRESETS.filter((p) => p.category === 'api').map((p) => (
                      <option key={p.id} value={p.id}>
                        {language === 'en' ? p.labelEn : language === 'nl' ? p.labelNl : p.labelFr}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup
                    label={tr(
                      language,
                      'Serveurs SMTP (boîte mail ou hébergeur)',
                      'SMTP Servers (mailbox or host)',
                      'SMTP-servers (mailbox of host)'
                    )}
                  >
                    {MAIL_PROVIDER_PRESETS.filter((p) => p.category === 'smtp').map((p) => (
                      <option key={p.id} value={p.id}>
                        {language === 'en' ? p.labelEn : language === 'nl' ? p.labelNl : p.labelFr}
                      </option>
                    ))}
                  </optgroup>
                </SearchableSelect>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {tr(
                    language,
                    'Nom du compte',
                    'Account Name',
                    'Naam van het account'
                  )}
                </label>
                <input
                  type="text"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="Ex. Brevo Production / Microsoft 365 Graph"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs"
                />
              </div>
            </div>

            {/* Bandeau d'aide contextuel du preset (Gmail, Brevo, etc.) */}
            {currentPreset.helpBannerFr && (
              <div className="p-3 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-[11px] text-sky-800 dark:text-sky-200 leading-relaxed">
                {language === 'en'
                  ? currentPreset.helpBannerEn
                  : language === 'nl'
                  ? currentPreset.helpBannerNl
                  : currentPreset.helpBannerFr}
              </div>
            )}

            {/* Bandeau d'avertissement spécifique (ex. Outlook / Microsoft 365 fin déc. 2026) + bouton bascule vers Graph */}
            {currentPreset.warningBannerFr && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200 font-semibold leading-relaxed space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    {language === 'en'
                      ? currentPreset.warningBannerEn
                      : language === 'nl'
                      ? currentPreset.warningBannerNl
                      : currentPreset.warningBannerFr}
                  </span>
                </div>
                {selectedPreset === 'outlook' && (
                  <div className="pl-6">
                    <button
                      type="button"
                      onClick={() => applyPresetDefaults('msgraph', Boolean(editingAccountId))}
                      className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white font-extrabold text-[11px] inline-flex items-center gap-1.5 shadow-xs transition cursor-pointer"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>
                        {tr(
                          language,
                          'Utiliser Microsoft 365 (Graph) à la place',
                          'Use Microsoft 365 (Graph) instead',
                          'Gebruik Microsoft 365 (Graph) in plaats daarvan'
                        )}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Champs et encadré d'aide spécifiques Microsoft 365 (Graph) */}
            {provider === 'msgraph' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(
                        language,
                        'ID du locataire (Tenant ID)',
                        'Tenant ID (Directory ID)',
                        'Tenant-ID (Map-ID)'
                      )}
                    </label>
                    <input
                      type="text"
                      value={msgraphTenantId}
                      onChange={(e) => setMsgraphTenantId(e.target.value)}
                      placeholder="GUID ou contoso.onmicrosoft.com"
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(
                        language,
                        "ID de l'application (Client ID)",
                        'Application (Client) ID',
                        'Applicatie-ID (Client-ID)'
                      )}
                    </label>
                    <input
                      type="text"
                      value={msgraphClientId}
                      onChange={(e) => setMsgraphClientId(e.target.value)}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {tr(
                        language,
                        "Date d'expiration du secret (optionnel)",
                        'Secret Expiration Date (optional)',
                        'Vervaldatum geheim (optioneel)'
                      )}
                    </label>
                    <input
                      type="date"
                      value={msgraphSecretExpiresAt}
                      onChange={(e) => setMsgraphSecretExpiresAt(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono"
                    />
                  </div>
                </div>

                {(() => {
                  const expiry = evaluateMsGraphSecretExpiry(msgraphSecretExpiresAt);
                  if (expiry.status === 'expired') {
                    return (
                      <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-[11px] text-rose-800 dark:text-rose-200 font-bold flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                        <span>
                          {tr(
                            language,
                            'Attention : le secret client Microsoft Entra est expiré. Créez un nouveau secret client dans Entra et enregistrez sa nouvelle Valeur ci-dessous.',
                            'Warning: the Microsoft Entra client secret has expired. Create a new client secret in Entra and save its new Value below.',
                            'Waarschuwing: het Microsoft Entra-clientgeheim is verlopen. Maak een nieuw clientgeheim aan in Entra en sla de nieuwe Waarde hieronder op.'
                          )}
                        </span>
                      </div>
                    );
                  }
                  if (expiry.status === 'expiring_soon') {
                    return (
                      <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200 font-bold flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                        <span>
                          {tr(
                            language,
                            `Attention : le secret client Microsoft Entra expire dans ${expiry.daysRemaining} jour(s) (durée maximale Microsoft : 24 mois). Pensez à le renouveler.`,
                            `Warning: Microsoft Entra client secret expires in ${expiry.daysRemaining} day(s) (Microsoft max lifetime: 24 months). Remember to renew it.`,
                            `Waarschuwing: het Microsoft Entra-clientgeheim verloopt over ${expiry.daysRemaining} dag(en) (max. 24 maanden). Vergeet niet te vernieuwen.`
                          )}
                        </span>
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* Encadré d'aide en 5 étapes pour l'administrateur Microsoft 365 */}
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-[11px] space-y-2">
                  <div className="font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <HelpCircle className="w-4 h-4 text-cyan-600 shrink-0" />
                    <span>
                      {tr(
                        language,
                        "À faire par l'administrateur Microsoft 365",
                        'Steps for the Microsoft 365 Administrator',
                        'Stappen voor de Microsoft 365-beheerder'
                      )}
                    </span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-slate-700 dark:text-slate-300 leading-relaxed">
                    <li>
                      {tr(
                        language,
                        "Centre d'administration Microsoft Entra > Inscriptions d'applications > Nouvelle inscription (nom : TOT Suite Mail).",
                        'Microsoft Entra admin center > App registrations > New registration (name: TOT Suite Mail).',
                        'Microsoft Entra-beheercentrum > App-registraties > Nieuwe registratie (naam: TOT Suite Mail).'
                      )}
                    </li>
                    <li>
                      {tr(
                        language,
                        "Copier l'ID de l'application (client) et l'ID de l'annuaire (locataire).",
                        'Copy the Application (client) ID and Directory (tenant) ID.',
                        'Kopieer de Applicatie-ID (client) en Map-ID (tenant).'
                      )}
                    </li>
                    <li>
                      {tr(
                        language,
                        "Certificats et secrets > Nouveau secret client : copier la Valeur (pas l'ID du secret) et la date d'expiration.",
                        'Certificates & secrets > New client secret: copy the Value (not the Secret ID) and expiration date.',
                        'Certificaten en geheimen > Nieuw clientgeheim: kopieer de Waarde (niet de geheim-ID) en de vervaldatum.'
                      )}
                    </li>
                    <li>
                      {tr(
                        language,
                        "Autorisations d'API > Ajouter > Microsoft Graph > Autorisations d'application > Mail.Send > Accorder le consentement d'administrateur.",
                        'API permissions > Add > Microsoft Graph > Application permissions > Mail.Send > Grant admin consent.',
                        'API-machtigingen > Toevoegen > Microsoft Graph > Applicatiemachtigingen > Mail.Send > Beheerderstoestemming verlenen.'
                      )}
                    </li>
                    <li>
                      {tr(
                        language,
                        "Recommandé : restreindre l'application aux seules boîtes d'envoi (New-ApplicationAccessPolicy dans Exchange Online).",
                        'Recommended: restrict the application to sending mailboxes only (New-ApplicationAccessPolicy in Exchange Online).',
                        'Aanbevolen: beperk de applicatie tot alleen verzendmailboxen (New-ApplicationAccessPolicy in Exchange Online).'
                      )}
                    </li>
                  </ol>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 pt-1">
                    {tr(
                      language,
                      'Note : les intitulés des menus Microsoft peuvent varier selon la langue et la version du portail Entra. ',
                      'Note: Microsoft menu labels may vary depending on portal language and version. ',
                      'Opmerking: Microsoft-menunamen kunnen variëren afhankelijk van taal en portaalversie. '
                    )}
                    <a
                      href="https://learn.microsoft.com/graph/auth-v2-service"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-600 dark:text-cyan-400 underline font-bold"
                    >
                      {tr(
                        language,
                        'Documentation officielle Microsoft Graph (OAuth2 service)',
                        'Official Microsoft Graph Documentation (OAuth2 service)',
                        'Officiële Microsoft Graph-documentatie (OAuth2-service)'
                      )}
                    </a>
                  </p>
                </div>
              </div>
            )}

            {/* Champs spécifiques Mailgun */}
            {currentPreset.requiresMailgunDomain && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(
                      language,
                      "Domaine d'envoi Mailgun",
                      'Mailgun Sending Domain',
                      'Mailgun-verzenddomein'
                    )}
                  </label>
                  <input
                    type="text"
                    value={mailgunDomain}
                    onChange={(e) => setMailgunDomain(e.target.value)}
                    placeholder="mg.votre-domaine.fr"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'Région API Mailgun', 'Mailgun API Region', 'Mailgun API-regio')}
                  </label>
                  <SearchableSelect
                    value={mailgunRegion}
                    onChange={(val) => setMailgunRegion(val as 'eu' | 'us')}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-bold"
                  >
                    <option value="eu">Europe (api.eu.mailgun.net)</option>
                    <option value="us">US / Global (api.mailgun.net)</option>
                  </SearchableSelect>
                </div>
              </div>
            )}

            {/* Champs spécifiques SMTP (hôte, port, chiffrement) */}
            {provider === 'smtp' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'Hôte SMTP', 'SMTP Host', 'SMTP-host')}
                  </label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="smtp.domaine.fr"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(
                      language,
                      'Port SMTP (25 non supporté)',
                      'SMTP Port (25 unsupported)',
                      'SMTP-poort (25 niet ondersteund)'
                    )}
                  </label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'Chiffrement', 'Encryption', 'Versleuteling')}
                  </label>
                  <SearchableSelect
                    value={encryption}
                    onChange={(val) => setEncryption(val as MailEncryptionKind)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-bold"
                  >
                    <option value="starttls">STARTTLS (port 587 recommandé)</option>
                    <option value="ssl">SSL / TLS implicite (port 465)</option>
                    <option value="none">Aucun (none)</option>
                  </SearchableSelect>
                </div>
              </div>
            )}

            {/* Identifiant (SMTP ou Mailjet) + Secret en écriture seule */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {currentPreset.requiresUsername && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {language === 'en'
                      ? currentPreset.usernameLabelEn
                      : language === 'nl'
                      ? currentPreset.usernameLabelNl
                      : currentPreset.usernameLabelFr}
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={currentPreset.usernamePlaceholder || ''}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono"
                  />
                </div>
              )}

              <div className={currentPreset.requiresUsername ? '' : 'sm:col-span-2'}>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    {language === 'en'
                      ? currentPreset.secretLabelEn
                      : language === 'nl'
                      ? currentPreset.secretLabelNl
                      : currentPreset.secretLabelFr}
                  </label>
                  {editingHasExistingSecret && (
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                      {tr(
                        language,
                        'Secret enregistré ✓ (●●●●●) — laisser vide pour conserver',
                        'Secret saved ✓ (●●●●●) — leave blank to keep',
                        'Geheim opgeslagen ✓ (●●●●●) — laat leeg om te behouden'
                      )}
                    </span>
                  )}
                </div>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={secretInput}
                  onChange={(e) => setSecretInput(e.target.value)}
                  placeholder={
                    editingHasExistingSecret
                      ? tr(
                          language,
                          '●●●●● (Secret enregistré ✓ dans Vault — saisir pour remplacer)',
                          '●●●●● (Secret saved ✓ in Vault — enter to replace)',
                          '●●●●● (Geheim opgeslagen ✓ in Vault — voer in om te vervangen)'
                        )
                      : currentPreset.secretPlaceholder
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="submit"
                disabled={isSavingAccount}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-sm transition cursor-pointer disabled:opacity-60"
              >
                {isSavingAccount ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                <span>
                  {tr(
                    language,
                    'Enregistrer le compte d’envoi',
                    'Save Mail Account',
                    'Verzendaccount opslaan'
                  )}
                </span>
              </button>
            </div>
          </form>

          {/* Zone de test d'envoi */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3">
            <h4 className="font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5 text-purple-600" />
              <span>
                {tr(
                  language,
                  'Envoyer un mail de test',
                  'Send a Test Email',
                  'Stuur een test-e-mail'
                )}
              </span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <SearchableSelect
                value={testAppCode}
                onChange={(val) => setTestAppCode(val)}
                className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-bold"
              >
                {SUITE_MAIL_APPLICATIONS.map((app) => (
                  <option key={app.code} value={app.code}>
                    {app.code.toUpperCase()} — {app.name}
                  </option>
                ))}
              </SearchableSelect>
              <input
                type="email"
                value={testRecipient}
                onChange={(e) => setTestRecipient(e.target.value)}
                placeholder="destinataire-test@domaine.fr"
                className="sm:col-span-2 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs"
              />
              <button
                type="button"
                disabled={isSendingTest}
                onClick={handleSendTestEmail}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-sm transition cursor-pointer disabled:opacity-60"
              >
                {isSendingTest ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>
                  {tr(
                    language,
                    'Envoyer un mail de test',
                    'Send test email',
                    'Testmail verzenden'
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* ONGLET 2 : EXPÉDITEURS PAR APPLICATION (core_mail_senders)            */}
      {/* ===================================================================== */}
      {activeTab === 'senders' && (
        <div className="space-y-3">
          <div className="p-3 rounded-2xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-[11px] text-sky-800 dark:text-sky-200 leading-relaxed">
            {tr(
              language,
              'La base Supabase est partagée entre les applications de la suite TOT. Chaque application dispose de son propre nom et de sa propre adresse d’expéditeur. L’application courante (TOT Stock — stk) est mise en évidence.',
              'The Supabase database is shared across TOT Suite applications. Each application has its own sender name and address. The current application (TOT Stock — stk) is highlighted.',
              'De Supabase-database wordt gedeeld door de TOT Suite-applicaties. Elke applicatie heeft een eigen afzendernaam en e-mailadres. De huidige applicatie (TOT Stock — stk) is gemarkeerd.'
            )}
          </div>

          <div className="space-y-3">
            {SUITE_MAIL_APPLICATIONS.map((appMeta) => {
              const row = senders.find((s) => s.app_code === appMeta.code) || {
                app_code: appMeta.code,
                from_name: appMeta.defaultFromName,
                from_email: '',
                reply_to: '',
                account_id: null,
              };
              const isCurrentApp = appMeta.code === CURRENT_MAIL_APP_CODE;
              const linkedAccount = row.account_id
                ? accounts.find((a) => a.id === row.account_id) || defaultActiveAccount
                : defaultActiveAccount;
              const domainCheck = checkSenderDomainMismatch(row.from_email, linkedAccount);
              const showVerifiedReminder = requiresVerifiedSenderReminder(linkedAccount?.provider);

              return (
                <div
                  key={appMeta.code}
                  className={`p-3.5 rounded-2xl border space-y-3 ${
                    isCurrentApp
                      ? 'border-orange-500 bg-orange-50/40 dark:bg-orange-950/20 shadow-xs'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-white dark:bg-slate-700 font-mono font-black text-[11px] uppercase">
                        {appMeta.code}
                      </span>
                      <span className="font-black text-xs text-slate-900 dark:text-white">
                        {appMeta.name}
                      </span>
                      {isCurrentApp && (
                        <span className="px-2 py-0.5 rounded-full bg-orange-600 text-white text-[10px] font-black">
                          {tr(
                            language,
                            'Application courante',
                            'Current application',
                            'Huidige applicatie'
                          )}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={savingSenderCode === appMeta.code}
                      onClick={() => handleSaveSenderRow(row)}
                      className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white font-extrabold text-[11px] flex items-center gap-1 cursor-pointer disabled:opacity-60"
                    >
                      {savingSenderCode === appMeta.code ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Check className="w-3 h-3" />
                      )}
                      <span>{tr(language, 'Enregistrer', 'Save', 'Opslaan')}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                        {tr(language, 'Nom affiché (from_name)', 'Display Name', 'Weergavenaam')}
                      </label>
                      <input
                        type="text"
                        value={row.from_name}
                        onChange={(e) =>
                          handleUpdateSenderRow(appMeta.code, 'from_name', e.target.value)
                        }
                        placeholder={appMeta.defaultFromName}
                        className="w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                        {tr(
                          language,
                          "Adresse d'expéditeur (from_email)",
                          'Sender Address',
                          'Afzenderadres'
                        )}
                      </label>
                      <input
                        type="email"
                        value={row.from_email}
                        onChange={(e) =>
                          handleUpdateSenderRow(appMeta.code, 'from_email', e.target.value)
                        }
                        placeholder={`${appMeta.code}@votre-domaine.fr`}
                        className="w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                        {tr(
                          language,
                          'Adresse de réponse (reply_to, optionnel)',
                          'Reply-To (optional)',
                          'Reply-To (optioneel)'
                        )}
                      </label>
                      <input
                        type="email"
                        value={row.reply_to || ''}
                        onChange={(e) =>
                          handleUpdateSenderRow(appMeta.code, 'reply_to', e.target.value)
                        }
                        placeholder="support@votre-domaine.fr"
                        className="w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                        {tr(language, "Compte d'envoi", 'Mail Account', 'Verzendaccount')}
                      </label>
                      <SearchableSelect
                        value={row.account_id || ''}
                        onChange={(val) =>
                          handleUpdateSenderRow(
                            appMeta.code,
                            'account_id',
                            val ? val : null
                          )
                        }
                        className="w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-bold"
                      >
                        <option value="">
                          {tr(
                            language,
                            'Compte actif par défaut',
                            'Default active account',
                            'Standaard actief account'
                          )}
                        </option>
                        {accounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name} ({acc.provider})
                          </option>
                        ))}
                      </SearchableSelect>
                    </div>
                  </div>

                  {/* Indications contextuelles */}
                  <div className="space-y-1 text-[11px]">
                    {!row.from_email.trim() && (
                      <p className="text-slate-500 dark:text-slate-400">
                        ℹ️{' '}
                        {tr(
                          language,
                          "Adresse d'expéditeur vide : l'envoi utilisera l'adresse de repli du compte d'envoi actif.",
                          'Sender address is empty: dispatch will fall back to the active mail account address.',
                          'Afzenderadres is leeg: verzending gebruikt het terugvaladres van het actieve verzendaccount.'
                        )}
                      </p>
                    )}

                    {domainCheck.mismatch && (
                      <p className="text-amber-700 dark:text-amber-300 font-semibold">
                        ⚠️{' '}
                        {tr(
                          language,
                          `Avertissement SPF / DKIM / DMARC : le domaine de l'expéditeur (${domainCheck.senderDomain}) diffère du domaine du compte (${domainCheck.accountDomain}). Vérifiez vos enregistrements DNS pour éviter le classement en indésirable.`,
                          `SPF / DKIM / DMARC warning: sender domain (${domainCheck.senderDomain}) differs from account domain (${domainCheck.accountDomain}). Check your DNS records to avoid spam filtering.`,
                          `SPF / DKIM / DMARC-waarschuwing: afzenderdomein (${domainCheck.senderDomain}) wijkt af van accountdomein (${domainCheck.accountDomain}). Controleer uw DNS-records.`
                        )}
                      </p>
                    )}

                    {showVerifiedReminder && row.from_email.trim() && (
                      <p className="text-cyan-700 dark:text-cyan-300">
                        ✓{' '}
                        {tr(
                          language,
                          `Rappel (${linkedAccount?.provider.toUpperCase()}) : assurez-vous que l'adresse "${row.from_email}" ou son domaine est validé dans les expéditeurs autorisés chez le fournisseur.`,
                          `Reminder (${linkedAccount?.provider.toUpperCase()}): ensure "${row.from_email}" or its domain is verified in your provider's allowed senders.`,
                          `Herinnering (${linkedAccount?.provider.toUpperCase()}): zorg dat "${row.from_email}" of het domein geverifieerd is bij de provider.`
                        )}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* ONGLET 3 : JOURNAL D'ENVOI (core_mail_log)                            */}
      {/* ===================================================================== */}
      {activeTab === 'logs' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
            <div className="flex flex-wrap items-center gap-2">
              <SearchableSelect
                value={logFilterApp}
                onChange={(val) => {
                  setLogFilterApp(val);
                  refreshLogs(val, logFilterStatus);
                }}
                className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-bold"
              >
                <option value="all">
                  {tr(language, 'Toutes les applications', 'All applications', 'Alle applicaties')}
                </option>
                {SUITE_MAIL_APPLICATIONS.map((app) => (
                  <option key={app.code} value={app.code}>
                    {app.code.toUpperCase()} — {app.name}
                  </option>
                ))}
              </SearchableSelect>

              <SearchableSelect
                value={logFilterStatus}
                onChange={(val) => {
                  setLogFilterStatus(val);
                  refreshLogs(logFilterApp, val);
                }}
                className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-bold"
              >
                <option value="all">
                  {tr(language, 'Tous les statuts', 'All statuses', 'Alle statussen')}
                </option>
                <option value="sent">{tr(language, 'Envoyé (sent)', 'Sent', 'Verzonden')}</option>
                <option value="failed">{tr(language, 'Échec (failed)', 'Failed', 'Mislukt')}</option>
                <option value="not_configured">
                  {tr(language, 'Non configuré', 'Not configured', 'Niet geconfigureerd')}
                </option>
              </SearchableSelect>
            </div>

            <button
              type="button"
              disabled={isPurgingLogs}
              onClick={handlePurgeLogs}
              className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[11px] flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              {isPurgingLogs ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              <span>
                {tr(
                  language,
                  'Purger (> 90 jours)',
                  'Purge (> 90 days)',
                  'Opschonen (> 90 dagen)'
                )}
              </span>
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
            {logs.length === 0 ? (
              <div className="p-6 text-center text-slate-400">
                <Mail className="w-6 h-6 mx-auto mb-1.5 opacity-50" />
                <p>
                  {tr(
                    language,
                    'Aucune entrée dans le journal core_mail_log.',
                    'No entries in core_mail_log.',
                    'Geen vermeldingen in core_mail_log.'
                  )}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-extrabold border-b border-slate-200 dark:border-slate-700">
                      <th className="py-2 px-2.5">{tr(language, 'Date', 'Date', 'Datum')}</th>
                      <th className="py-2 px-2.5">App</th>
                      <th className="py-2 px-2.5">
                        {tr(language, 'Destinataire', 'Recipient', 'Ontvanger')}
                      </th>
                      <th className="py-2 px-2.5">
                        {tr(language, 'Sujet', 'Subject', 'Onderwerp')}
                      </th>
                      <th className="py-2 px-2.5">
                        {tr(language, 'Fournisseur', 'Provider', 'Provider')}
                      </th>
                      <th className="py-2 px-2.5">
                        {tr(language, 'Statut', 'Status', 'Status')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {logs.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2 px-2.5 whitespace-nowrap font-mono text-[10px] text-slate-500">
                          {new Date(item.created_at).toLocaleString()}
                        </td>
                        <td className="py-2 px-2.5 font-mono font-bold uppercase">
                          {item.app_code}
                        </td>
                        <td className="py-2 px-2.5 font-mono">{item.recipient_masked}</td>
                        <td className="py-2 px-2.5 max-w-[200px] truncate" title={item.subject}>
                          {item.subject}
                          {item.error_message && (
                            <div className="text-[10px] text-rose-600 dark:text-rose-400 truncate">
                              {item.error_message}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2.5 font-mono uppercase">
                          {item.provider || '—'}
                        </td>
                        <td className="py-2 px-2.5">
                          <span
                            className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                              item.status === 'sent'
                                ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                : item.status === 'not_configured'
                                ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                                : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                            }`}
                          >
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const SmtpSettingsModal: React.FC = () => {
  const { smtpSettingsModalOpen, setSmtpSettingsModalOpen } = useApp();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && smtpSettingsModalOpen) {
        setSmtpSettingsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [smtpSettingsModalOpen, setSmtpSettingsModalOpen]);

  if (!smtpSettingsModalOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setSmtpSettingsModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="w-full max-w-3xl bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 max-h-[92dvh] sm:max-h-[92vh] overflow-y-auto">
        <EmailSettingsPanel
          embedded={false}
          onClose={() => setSmtpSettingsModalOpen(false)}
        />
      </div>
    </div>
  );
};
