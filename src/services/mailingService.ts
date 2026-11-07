import { TABLES, SUITE_MAIL_APPLICATIONS, CURRENT_MAIL_APP_CODE } from '../constants/tables';
import { getResolvedEdgeFunctionName } from '../constants/edgeFunctions';

export type MailProviderKind =
  | 'brevo'
  | 'resend'
  | 'sendgrid'
  | 'mailgun'
  | 'postmark'
  | 'mailjet'
  | 'smtp'
  | 'msgraph';

export type MailEncryptionKind = 'ssl' | 'starttls' | 'none';

export type MailPresetId =
  | 'brevo'
  | 'resend'
  | 'sendgrid'
  | 'mailgun'
  | 'postmark'
  | 'mailjet'
  | 'msgraph'
  | 'gmail'
  | 'outlook'
  | 'ovh'
  | 'infomaniak'
  | 'smtp_custom';

export interface MailPresetDefinition {
  id: MailPresetId;
  category: 'api' | 'smtp';
  provider: MailProviderKind;
  labelFr: string;
  labelEn: string;
  labelNl: string;
  defaultHost?: string;
  defaultPort?: number;
  defaultEncryption?: MailEncryptionKind;
  secretLabelFr: string;
  secretLabelEn: string;
  secretLabelNl: string;
  secretPlaceholder: string;
  requiresUsername?: boolean;
  usernameLabelFr?: string;
  usernameLabelEn?: string;
  usernameLabelNl?: string;
  usernamePlaceholder?: string;
  requiresMailgunDomain?: boolean;
  helpBannerFr?: string;
  helpBannerEn?: string;
  helpBannerNl?: string;
  warningBannerFr?: string;
  warningBannerEn?: string;
  warningBannerNl?: string;
}

export const MAIL_PROVIDER_PRESETS: MailPresetDefinition[] = [
  {
    id: 'brevo',
    category: 'api',
    provider: 'brevo',
    labelFr: 'Brevo (ex-Sendinblue — API HTTP)',
    labelEn: 'Brevo (formerly Sendinblue — HTTP API)',
    labelNl: 'Brevo (voorheen Sendinblue — HTTP API)',
    secretLabelFr: 'Clé API Brevo v3',
    secretLabelEn: 'Brevo v3 API Key',
    secretLabelNl: 'Brevo v3 API-sleutel',
    secretPlaceholder: 'xkeysib-...',
    helpBannerFr:
      'Générez une clé API v3 dans Brevo > SMTP & API > Clés API et validez votre adresse ou domaine expéditeur.',
    helpBannerEn:
      'Generate a v3 API key in Brevo > SMTP & API > API Keys and verify your sender address or domain.',
    helpBannerNl:
      'Genereer een v3 API-sleutel in Brevo > SMTP & API > API-sleutels en verifieer uw afzenderadres of domein.',
  },
  {
    id: 'resend',
    category: 'api',
    provider: 'resend',
    labelFr: 'Resend (API HTTP)',
    labelEn: 'Resend (HTTP API)',
    labelNl: 'Resend (HTTP API)',
    secretLabelFr: 'Clé API Resend',
    secretLabelEn: 'Resend API Key',
    secretLabelNl: 'Resend API-sleutel',
    secretPlaceholder: 're_...',
    helpBannerFr:
      "Validez votre domaine DNS (SPF/DKIM) dans Resend > Domains avant d'envoyer depuis vos adresses d'application.",
    helpBannerEn:
      'Verify your DNS domain (SPF/DKIM) in Resend > Domains before sending from your application addresses.',
    helpBannerNl:
      'Verifieer uw DNS-domein (SPF/DKIM) in Resend > Domains voordat u verzendt vanaf uw applicatieadressen.',
  },
  {
    id: 'sendgrid',
    category: 'api',
    provider: 'sendgrid',
    labelFr: 'SendGrid (API HTTP)',
    labelEn: 'SendGrid (HTTP API)',
    labelNl: 'SendGrid (HTTP API)',
    secretLabelFr: 'Clé API SendGrid',
    secretLabelEn: 'SendGrid API Key',
    secretLabelNl: 'SendGrid API-sleutel',
    secretPlaceholder: 'SG....',
    helpBannerFr:
      'Créez une clé avec la permission Mail Send dans SendGrid > Settings > API Keys et validez votre Sender Authentication.',
    helpBannerEn:
      'Create a key with Mail Send permission in SendGrid > Settings > API Keys and verify Sender Authentication.',
    helpBannerNl:
      'Maak een sleutel met Mail Send-rechten in SendGrid > Settings > API Keys en verifieer Sender Authentication.',
  },
  {
    id: 'mailgun',
    category: 'api',
    provider: 'mailgun',
    labelFr: 'Mailgun (API HTTP EU / US)',
    labelEn: 'Mailgun (HTTP API EU / US)',
    labelNl: 'Mailgun (HTTP API EU / US)',
    secretLabelFr: 'Clé API privée Mailgun',
    secretLabelEn: 'Mailgun Private API Key',
    secretLabelNl: 'Mailgun Privé API-sleutel',
    secretPlaceholder: 'key-...',
    requiresMailgunDomain: true,
    helpBannerFr:
      "Renseignez le domaine d'envoi validé dans Mailgun (ex. mg.votre-domaine.fr) et choisissez la région (EU recommandée).",
    helpBannerEn:
      'Enter your verified Mailgun sending domain (e.g. mg.your-domain.com) and select the region (EU recommended).',
    helpBannerNl:
      'Vul uw geverifieerde Mailgun-verzenddomein in (bijv. mg.uw-domein.be) en kies de regio (EU aanbevolen).',
  },
  {
    id: 'postmark',
    category: 'api',
    provider: 'postmark',
    labelFr: 'Postmark (API HTTP)',
    labelEn: 'Postmark (HTTP API)',
    labelNl: 'Postmark (HTTP API)',
    secretLabelFr: 'Jeton serveur Postmark (X-Postmark-Server-Token)',
    secretLabelEn: 'Postmark Server Token (X-Postmark-Server-Token)',
    secretLabelNl: 'Postmark Server-token (X-Postmark-Server-Token)',
    secretPlaceholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    helpBannerFr:
      'Copiez le Server API Token de votre serveur Postmark (onglet API Tokens) et validez vos signatures expéditeur.',
    helpBannerEn:
      'Copy the Server API Token from your Postmark server (API Tokens tab) and verify your Sender Signatures.',
    helpBannerNl:
      'Kopieer de Server API Token van uw Postmark-server (tabblad API Tokens) en verifieer uw Sender Signatures.',
  },
  {
    id: 'mailjet',
    category: 'api',
    provider: 'mailjet',
    labelFr: 'Mailjet (API HTTP v3.1)',
    labelEn: 'Mailjet (HTTP API v3.1)',
    labelNl: 'Mailjet (HTTP API v3.1)',
    requiresUsername: true,
    usernameLabelFr: 'Clé API publique Mailjet (API Key)',
    usernameLabelEn: 'Mailjet Public API Key',
    usernameLabelNl: 'Mailjet Publieke API-sleutel',
    usernamePlaceholder: 'Clé API publique Mailjet',
    secretLabelFr: 'Clé secrète Mailjet (Secret Key)',
    secretLabelEn: 'Mailjet Secret Key',
    secretLabelNl: 'Mailjet Geheime Sleutel',
    secretPlaceholder: 'Clé secrète Mailjet',
    helpBannerFr:
      'Saisissez la clé API publique dans Identifiant et la clé secrète dans Secret (stockée dans Supabase Vault).',
    helpBannerEn:
      'Enter the public API key in Username and the secret key in Secret (stored in Supabase Vault).',
    helpBannerNl:
      'Vul de publieke API-sleutel in bij Gebruikersnaam en de geheime sleutel bij Geheim (opgeslagen in Supabase Vault).',
  },
  {
    id: 'msgraph',
    category: 'api',
    provider: 'msgraph',
    labelFr: 'Microsoft 365 (Graph) — recommandé pour Outlook',
    labelEn: 'Microsoft 365 (Graph) — recommended for Outlook',
    labelNl: 'Microsoft 365 (Graph) — aanbevolen voor Outlook',
    secretLabelFr: 'Secret client Microsoft Entra (Valeur)',
    secretLabelEn: 'Microsoft Entra Client Secret (Value)',
    secretLabelNl: 'Microsoft Entra Clientgeheim (Waarde)',
    secretPlaceholder: 'Valeur du secret client Entra (ex. ~8Q...)',
    helpBannerFr:
      'Envoi moderne via Microsoft Graph OAuth2 (client_credentials, Mail.Send). Recommandé pour les boîtes Exchange Online / Microsoft 365 suite à la fin du SMTP Basic Auth.',
    helpBannerEn:
      'Modern dispatch via Microsoft Graph OAuth2 (client_credentials, Mail.Send). Recommended for Exchange Online / Microsoft 365 mailboxes following SMTP Basic Auth retirement.',
    helpBannerNl:
      'Moderne verzending via Microsoft Graph OAuth2 (client_credentials, Mail.Send). Aanbevolen voor Exchange Online / Microsoft 365 na het uitfaseren van SMTP Basic Auth.',
  },
  {
    id: 'gmail',
    category: 'smtp',
    provider: 'smtp',
    labelFr: 'Gmail / Google Workspace (SMTP)',
    labelEn: 'Gmail / Google Workspace (SMTP)',
    labelNl: 'Gmail / Google Workspace (SMTP)',
    defaultHost: 'smtp.gmail.com',
    defaultPort: 587,
    defaultEncryption: 'starttls',
    requiresUsername: true,
    usernameLabelFr: 'Adresse Gmail / Google Workspace',
    usernameLabelEn: 'Gmail / Google Workspace Address',
    usernameLabelNl: 'Gmail / Google Workspace-adres',
    usernamePlaceholder: 'votre.adresse@gmail.com',
    secretLabelFr: "Mot de passe d'application Google (16 caractères)",
    secretLabelEn: 'Google App Password (16 characters)',
    secretLabelNl: 'Google App-wachtwoord (16 tekens)',
    secretPlaceholder: 'xxxx xxxx xxxx xxxx',
    helpBannerFr:
      "Activez la validation en 2 étapes sur votre compte Google puis créez un mot de passe d'application de 16 caractères sur myaccount.google.com/apppasswords. Limite d'envoi : ~500 e-mails/jour. Note : Gmail réécrit automatiquement l'adresse d'expéditeur avec celle du compte sauf si l'adresse est déclarée comme alias validé dans Gmail.",
    helpBannerEn:
      'Enable 2-Step Verification on your Google account, then create a 16-character App Password at myaccount.google.com/apppasswords. Sending limit: ~500 emails/day. Note: Gmail rewrites the sender address to the account address unless configured as a verified alias in Gmail.',
    helpBannerNl:
      'Schakel verificatie in 2 stappen in op uw Google-account en maak vervolgens een app-wachtwoord van 16 tekens aan op myaccount.google.com/apppasswords. Verzendlimiet: ~500 e-mails/dag. Let op: Gmail herschrijft het afzenderadres tenzij het als geverifieerde alias is ingesteld.',
  },
  {
    id: 'outlook',
    category: 'smtp',
    provider: 'smtp',
    labelFr: 'Outlook / Microsoft 365 (SMTP)',
    labelEn: 'Outlook / Microsoft 365 (SMTP)',
    labelNl: 'Outlook / Microsoft 365 (SMTP)',
    defaultHost: 'smtp.office365.com',
    defaultPort: 587,
    defaultEncryption: 'starttls',
    requiresUsername: true,
    usernameLabelFr: 'Adresse Microsoft 365 / Outlook',
    usernameLabelEn: 'Microsoft 365 / Outlook Address',
    usernameLabelNl: 'Microsoft 365 / Outlook-adres',
    usernamePlaceholder: 'contact@entreprise.com',
    secretLabelFr: "Mot de passe ou mot de passe d'application Microsoft",
    secretLabelEn: 'Microsoft Password or App Password',
    secretLabelNl: 'Microsoft-wachtwoord of app-wachtwoord',
    secretPlaceholder: '••••••••••••',
    warningBannerFr:
      "Attention : Microsoft désactive définitivement l'authentification SMTP de base (Basic Auth) fin décembre 2026 sur Exchange Online / Microsoft 365. Nous vous recommandons vivement d'utiliser un service transactionnel (Brevo, Resend, SendGrid, Postmark ou Mailgun).",
    warningBannerEn:
      'Warning: Microsoft is permanently retiring Basic SMTP Authentication at the end of December 2026 on Exchange Online / Microsoft 365. We strongly recommend using a transactional email provider (Brevo, Resend, SendGrid, Postmark, or Mailgun).',
    warningBannerNl:
      'Waarschuwing: Microsoft schakelt basis-SMTP-authenticatie eind december 2026 definitief uit op Exchange Online / Microsoft 365. Wij raden sterk aan een transactionele e-maildienst (Brevo, Resend, SendGrid, Postmark of Mailgun) te gebruiken.',
  },
  {
    id: 'ovh',
    category: 'smtp',
    provider: 'smtp',
    labelFr: 'OVHcloud Mail (SMTP)',
    labelEn: 'OVHcloud Mail (SMTP)',
    labelNl: 'OVHcloud Mail (SMTP)',
    defaultHost: 'ssl0.ovh.net',
    defaultPort: 465,
    defaultEncryption: 'ssl',
    requiresUsername: true,
    usernameLabelFr: 'Adresse e-mail OVH complète',
    usernameLabelEn: 'Full OVH Email Address',
    usernameLabelNl: 'Volledig OVH e-mailadres',
    usernamePlaceholder: 'contact@votre-domaine.fr',
    secretLabelFr: 'Mot de passe de la boîte OVH',
    secretLabelEn: 'OVH Mailbox Password',
    secretLabelNl: 'Wachtwoord van OVH-mailbox',
    secretPlaceholder: '••••••••••••',
    helpBannerFr:
      'Utilisez ssl0.ovh.net sur le port 465 (SSL/TLS) ou le port 587 (STARTTLS) avec votre adresse e-mail OVH complète.',
    helpBannerEn:
      'Use ssl0.ovh.net on port 465 (SSL/TLS) or port 587 (STARTTLS) with your full OVH email address.',
    helpBannerNl:
      'Gebruik ssl0.ovh.net op poort 465 (SSL/TLS) of poort 587 (STARTTLS) met uw volledige OVH e-mailadres.',
  },
  {
    id: 'infomaniak',
    category: 'smtp',
    provider: 'smtp',
    labelFr: 'Infomaniak Mail (SMTP)',
    labelEn: 'Infomaniak Mail (SMTP)',
    labelNl: 'Infomaniak Mail (SMTP)',
    defaultHost: 'mail.infomaniak.com',
    defaultPort: 465,
    defaultEncryption: 'ssl',
    requiresUsername: true,
    usernameLabelFr: 'Adresse e-mail Infomaniak complète',
    usernameLabelEn: 'Full Infomaniak Email Address',
    usernameLabelNl: 'Volledig Infomaniak e-mailadres',
    usernamePlaceholder: 'contact@votre-domaine.ch',
    secretLabelFr: "Mot de passe ou mot de passe d'application Infomaniak",
    secretLabelEn: 'Infomaniak Password or App Password',
    secretLabelNl: 'Infomaniak-wachtwoord of app-wachtwoord',
    secretPlaceholder: '••••••••••••',
    helpBannerFr:
      'Utilisez mail.infomaniak.com sur le port 465 (SSL/TLS) ou 587 (STARTTLS). Si la 2FA est activée, générez un mot de passe d’application.',
    helpBannerEn:
      'Use mail.infomaniak.com on port 465 (SSL/TLS) or 587 (STARTTLS). If 2FA is enabled, generate an application password.',
    helpBannerNl:
      'Gebruik mail.infomaniak.com op poort 465 (SSL/TLS) of 587 (STARTTLS). Maak een applicatiewachtwoord aan als 2FA is ingeschakeld.',
  },
  {
    id: 'smtp_custom',
    category: 'smtp',
    provider: 'smtp',
    labelFr: 'Autre serveur SMTP personnalisé',
    labelEn: 'Other Custom SMTP Server',
    labelNl: 'Andere aangepaste SMTP-server',
    defaultHost: '',
    defaultPort: 587,
    defaultEncryption: 'starttls',
    requiresUsername: true,
    usernameLabelFr: 'Identifiant SMTP',
    usernameLabelEn: 'SMTP Username',
    usernameLabelNl: 'SMTP-gebruikersnaam',
    usernamePlaceholder: 'utilisateur@domaine.fr',
    secretLabelFr: 'Mot de passe SMTP',
    secretLabelEn: 'SMTP Password',
    secretLabelNl: 'SMTP-wachtwoord',
    secretPlaceholder: '••••••••••••',
    helpBannerFr:
      'Utilisez le port 587 (STARTTLS) ou 465 (SSL/TLS). Le port 25 n’est pas pris en charge par les fonctions Edge.',
    helpBannerEn:
      'Use port 587 (STARTTLS) or 465 (SSL/TLS). Port 25 is not supported by Edge Functions.',
    helpBannerNl:
      'Gebruik poort 587 (STARTTLS) of 465 (SSL/TLS). Poort 25 wordt niet ondersteund door Edge Functions.',
  },
];

export const MAIL_ADMIN_ROLE_IDS = [0, 1, 5, 8] as const;

/**
 * Règle unique d'autorisation pour l'administration e-mail / SMTP (UI + SQL _tot_is_mail_admin + Edge Function) :
 * rôles 0, 1, 5, 8 ou permission perm_config_email ou perm_config_db.
 */
export function canUserManageMailSettings(
  user?: { role_id?: number | string | null } | null,
  hasPerm?: (perm: string) => boolean
): boolean {
  if (!user) return false;
  const roleId = Number(user.role_id);
  if ((MAIL_ADMIN_ROLE_IDS as readonly number[]).includes(roleId)) {
    return true;
  }
  if (typeof hasPerm === 'function') {
    return Boolean(hasPerm('perm_config_email') || hasPerm('perm_config_db'));
  }
  return false;
}

export interface MailAccountRecord {
  id: string;
  name: string;
  provider: MailProviderKind;
  preset?: string | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_encryption?: MailEncryptionKind | null;
  smtp_username?: string | null;
  host?: string | null;
  port?: number | null;
  encryption?: MailEncryptionKind | null;
  username?: string | null;
  extra?: Record<string, any> | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  has_secret?: boolean;
}

export interface MailSenderRecord {
  app_code: string;
  from_name: string;
  from_email: string;
  reply_to?: string | null;
  account_id?: string | null;
  updated_at?: string;
}

export type MailLogKind = 'transactional' | 'report' | 'order' | 'alert' | 'test';

export interface MailLogRecord {
  id: string | number;
  created_at: string;
  app_code: string;
  account_id?: string | null;
  provider?: string | null;
  sender_email?: string | null;
  recipient_masked: string;
  recipient_count?: number;
  subject: string;
  kind: MailLogKind;
  status: 'sent' | 'failed' | 'not_configured';
  message_id?: string | null;
  error_message?: string | null;
  user_id?: string | null;
}

export function getPresetById(presetId?: string | null, provider?: string | null): MailPresetDefinition {
  const byPreset = MAIL_PROVIDER_PRESETS.find((p) => p.id === presetId);
  if (byPreset) return byPreset;
  const byProvider = MAIL_PROVIDER_PRESETS.find((p) => p.provider === provider);
  return byProvider || MAIL_PROVIDER_PRESETS[0];
}

export function isValidEmailAddress(email: string): boolean {
  const trimmed = String(email || '').trim();
  if (!trimmed || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function isValidGuid(value: string): boolean {
  const trimmed = String(value || '').trim();
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(trimmed);
}

export function isValidMsGraphTenant(value: string): boolean {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  if (isValidGuid(trimmed)) return true;
  return /^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed);
}

export function evaluateMsGraphSecretExpiry(
  secretExpiresAt?: string | null,
  nowMs: number = Date.now()
): {
  status: 'none' | 'ok' | 'expiring_soon' | 'expired';
  daysRemaining: number | null;
} {
  const raw = String(secretExpiresAt || '').trim();
  if (!raw) {
    return { status: 'none', daysRemaining: null };
  }
  const parsed = Date.parse(raw.length === 10 ? `${raw}T23:59:59Z` : raw);
  if (Number.isNaN(parsed)) {
    return { status: 'none', daysRemaining: null };
  }
  const diffDays = Math.ceil((parsed - nowMs) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    return { status: 'expired', daysRemaining: diffDays };
  }
  if (diffDays <= 30) {
    return { status: 'expiring_soon', daysRemaining: diffDays };
  }
  return { status: 'ok', daysRemaining: diffDays };
}

export function redactClientSecrets(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/xkeysib-[a-zA-Z0-9_-]+/gi, '[REDACTED]')
    .replace(/\bre_[a-zA-Z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/\bSG\.[a-zA-Z0-9_.-]{10,}/g, '[REDACTED]')
    .replace(/\bkey-[a-zA-Z0-9_-]{10,}/gi, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');
}

/**
 * Lit le corps JSON de `error.context` (qui est une `Response` dans `@supabase/supabase-js` quand la fonction Edge
 * renvoie un statut non-2xx) pour afficher le champ `error` lisible et le code HTTP sans jamais exposer de secret.
 */
export async function extractEdgeFunctionError(
  error: any,
  fallbackData?: any
): Promise<{ message: string; statusCode?: number; configured?: boolean }> {
  let statusCode: number | undefined =
    typeof error?.status === 'number' ? error.status : undefined;
  let extractedError = '';
  let configured: boolean | undefined =
    typeof fallbackData?.configured === 'boolean' ? fallbackData.configured : undefined;

  const ctx = error?.context;
  if (ctx) {
    if (typeof ctx.status === 'number') {
      statusCode = ctx.status;
    }
    try {
      if (typeof ctx.clone === 'function') {
        const body = await ctx.clone().json();
        if (body && typeof body === 'object') {
          extractedError = String(body.error || body.message || '').trim();
          if (typeof body.configured === 'boolean') {
            configured = body.configured;
          }
        }
      } else if (typeof ctx.json === 'function') {
        const body = await ctx.json();
        if (body && typeof body === 'object') {
          extractedError = String(body.error || body.message || '').trim();
          if (typeof body.configured === 'boolean') {
            configured = body.configured;
          }
        }
      } else if (typeof ctx.text === 'function') {
        const rawText = await ctx.text();
        try {
          const parsed = JSON.parse(rawText);
          extractedError = String(parsed?.error || parsed?.message || '').trim();
          if (typeof parsed?.configured === 'boolean') {
            configured = parsed.configured;
          }
        } catch {
          extractedError = String(rawText || '').trim();
        }
      }
    } catch {
      // Ignorer si le flux Response a déjà été consommé ou n'est pas du JSON
    }
  }

  if (!extractedError && fallbackData && typeof fallbackData === 'object') {
    extractedError = String(fallbackData.error || fallbackData.message || '').trim();
  }

  if (!extractedError && error?.message) {
    extractedError = String(error.message).trim();
  }

  const safeMsg = redactClientSecrets(
    extractedError || "Erreur lors de l'appel de la fonction Edge."
  );

  return {
    message: safeMsg,
    statusCode,
    configured,
  };
}

export function extractEmailDomain(email?: string | null): string {
  const trimmed = String(email || '').trim().toLowerCase();
  const atIdx = trimmed.indexOf('@');
  if (atIdx < 0 || atIdx === trimmed.length - 1) return '';
  return trimmed.slice(atIdx + 1);
}

/**
 * Vérifie si le domaine de l'adresse d'expéditeur diffère du domaine du compte d'envoi (SPF / DKIM / DMARC).
 */
export function checkSenderDomainMismatch(
  senderEmail: string,
  account?: MailAccountRecord | null
): { mismatch: boolean; senderDomain: string; accountDomain: string } {
  const senderDomain = extractEmailDomain(senderEmail);
  if (!senderDomain || !account) {
    return { mismatch: false, senderDomain, accountDomain: '' };
  }

  let accountDomain = '';
  const accountUsername = account.smtp_username || account.username;
  if (account.provider === 'mailgun' && account.extra?.domain) {
    accountDomain = String(account.extra.domain).trim().toLowerCase();
  } else if (
    account.provider === 'msgraph' &&
    account.extra?.tenant_id &&
    !isValidGuid(String(account.extra.tenant_id))
  ) {
    accountDomain = String(account.extra.tenant_id).trim().toLowerCase();
  } else if (accountUsername && accountUsername.includes('@')) {
    accountDomain = extractEmailDomain(accountUsername);
  }

  if (!accountDomain) {
    return { mismatch: false, senderDomain, accountDomain: '' };
  }

  const isSameOrSubdomain =
    senderDomain === accountDomain ||
    accountDomain.endsWith(`.${senderDomain}`) ||
    senderDomain.endsWith(`.${accountDomain}`);

  return {
    mismatch: !isSameOrSubdomain,
    senderDomain,
    accountDomain,
  };
}

export function requiresVerifiedSenderReminder(provider?: MailProviderKind | null): boolean {
  return (
    provider === 'brevo' ||
    provider === 'resend' ||
    provider === 'sendgrid' ||
    provider === 'mailgun' ||
    provider === 'postmark' ||
    provider === 'mailjet' ||
    provider === 'msgraph'
  );
}

function normalizeAccountRow(row: any): MailAccountRecord {
  return {
    ...row,
    smtp_host: row.smtp_host ?? row.host ?? null,
    smtp_port: row.smtp_port ?? row.port ?? null,
    smtp_encryption: row.smtp_encryption ?? row.encryption ?? null,
    smtp_username: row.smtp_username ?? row.username ?? null,
    host: row.smtp_host ?? row.host ?? null,
    port: row.smtp_port ?? row.port ?? null,
    encryption: row.smtp_encryption ?? row.encryption ?? null,
    username: row.smtp_username ?? row.username ?? null,
  };
}

/**
 * Charge la liste des comptes d'envoi et vérifie pour chacun si un secret est présent dans Vault
 * (sans jamais exposer ni lire la valeur du secret).
 */
export async function fetchMailAccountsWithSecretStatus(
  client: any
): Promise<MailAccountRecord[]> {
  if (!client) return [];
  const { data, error } = await client
    .from(TABLES.mailAccounts)
    .select(
      'id, name, provider, preset, smtp_host, smtp_port, smtp_encryption, smtp_username, extra, is_active, created_at, updated_at'
    )
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: true });

  if (error || !Array.isArray(data)) {
    return [];
  }

  const enriched: MailAccountRecord[] = [];
  for (const row of data) {
    let hasSecret = false;
    try {
      const { data: statusData } = await client.rpc('mail_account_has_secret', {
        p_account_id: row.id,
      });
      hasSecret = Boolean(statusData);
    } catch {
      hasSecret = false;
    }
    enriched.push({
      ...normalizeAccountRow(row),
      has_secret: hasSecret,
    });
  }
  return enriched;
}

/**
 * Enregistre ou met à jour les métadonnées d'un compte d'envoi (hors secret).
 */
export async function saveMailAccountMetadata(
  client: any,
  input: {
    id?: string;
    name: string;
    provider: MailProviderKind;
    preset?: string | null;
    host?: string | null;
    port?: number | null;
    encryption?: MailEncryptionKind | null;
    username?: string | null;
    extra?: Record<string, any> | null;
    is_active: boolean;
  }
): Promise<{ ok: boolean; account?: MailAccountRecord; error?: string }> {
  if (!client) {
    return { ok: false, error: 'Client Supabase non connecté.' };
  }
  if (input.provider === 'smtp' && Number(input.port) === 25) {
    return {
      ok: false,
      error:
        "Le port SMTP 25 n'est pas pris en charge par les fonctions Edge. Utilisez le port 587 (STARTTLS) ou 465 (SSL/TLS).",
    };
  }
  if (input.provider === 'msgraph') {
    const tenantId = String(input.extra?.tenant_id || '').trim();
    const clientId = String(input.extra?.client_id || '').trim();
    if (!isValidMsGraphTenant(tenantId)) {
      return {
        ok: false,
        error:
          "Microsoft 365 (Graph) : veuillez renseigner un ID de locataire (tenant_id) valide (GUID ou domaine ex. contoso.onmicrosoft.com).",
      };
    }
    if (!isValidGuid(clientId)) {
      return {
        ok: false,
        error:
          "Microsoft 365 (Graph) : veuillez renseigner un ID d'application (client_id) au format GUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).",
      };
    }
  }

  try {
    // Si ce compte devient le compte actif par défaut, désactiver les autres d'abord pour respecter l'index unique partiel
    if (input.is_active) {
      let deactivateQuery = client
        .from(TABLES.mailAccounts)
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('is_active', true);
      if (input.id) {
        deactivateQuery = deactivateQuery.neq('id', input.id);
      }
      await deactivateQuery;
    }

    const payload: Record<string, any> = {
      name: input.name.trim(),
      provider: input.provider,
      preset: input.preset || input.provider,
      smtp_host: input.host ? input.host.trim() : null,
      smtp_port: input.port ? Number(input.port) : null,
      smtp_encryption: input.encryption || 'starttls',
      smtp_username: input.username ? input.username.trim() : null,
      extra: input.extra || {},
      is_active: Boolean(input.is_active),
      updated_at: new Date().toISOString(),
    };

    const selectCols =
      'id, name, provider, preset, smtp_host, smtp_port, smtp_encryption, smtp_username, extra, is_active, created_at, updated_at';

    if (input.id) {
      const { data, error } = await client
        .from(TABLES.mailAccounts)
        .update(payload)
        .eq('id', input.id)
        .select(selectCols)
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, account: normalizeAccountRow(data) };
    } else {
      const { data, error } = await client
        .from(TABLES.mailAccounts)
        .insert([payload])
        .select(selectCols)
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, account: normalizeAccountRow(data) };
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Erreur lors de la sauvegarde du compte.' };
  }
}

/**
 * Enregistre le secret (clé API ou mot de passe SMTP) en écriture seule dans Supabase Vault via RPC.
 * Le secret n'est jamais stocké dans localStorage ni conservé en mémoire après cet appel.
 */
export async function saveMailAccountSecretWriteOnly(
  client: any,
  accountId: string,
  secret: string
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = String(secret || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Le secret ne peut pas être vide.' };
  }
  if (!client) {
    return { ok: false, error: 'Client Supabase non connecté.' };
  }
  try {
    const { error } = await client.rpc('set_mail_account_secret', {
      p_account_id: accountId,
      p_secret: trimmed,
    });
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Erreur lors de l'enregistrement du secret dans Vault." };
  }
}

export async function deleteMailAccountById(
  client: any,
  accountId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!client) return { ok: false, error: 'Client Supabase non connecté.' };
  const { error } = await client.from(TABLES.mailAccounts).delete().eq('id', accountId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Charge les 4 expéditeurs d'applications de la suite (`stk`, `hab`, `rpt`, `tools`).
 */
export async function fetchSuiteMailSenders(client: any): Promise<MailSenderRecord[]> {
  const defaultRows: MailSenderRecord[] = SUITE_MAIL_APPLICATIONS.map((app) => ({
    app_code: app.code,
    from_name: app.defaultFromName,
    from_email: '',
    reply_to: '',
    account_id: null,
  }));

  if (!client) return defaultRows;

  const { data, error } = await client
    .from(TABLES.mailSenders)
    .select('app_code, from_name, from_email, reply_to, account_id, updated_at');

  if (error || !Array.isArray(data)) {
    return defaultRows;
  }

  const byCode = new Map<string, MailSenderRecord>();
  for (const row of data) {
    if (row?.app_code) {
      byCode.set(String(row.app_code), {
        app_code: String(row.app_code),
        from_name: String(row.from_name || ''),
        from_email: String(row.from_email || ''),
        reply_to: row.reply_to ? String(row.reply_to) : '',
        account_id: row.account_id ? String(row.account_id) : null,
        updated_at: row.updated_at,
      });
    }
  }

  return SUITE_MAIL_APPLICATIONS.map((app) => {
    const existing = byCode.get(app.code);
    return (
      existing || {
        app_code: app.code,
        from_name: app.defaultFromName,
        from_email: '',
        reply_to: '',
        account_id: null,
      }
    );
  });
}

export async function saveSuiteMailSender(
  client: any,
  sender: MailSenderRecord
): Promise<{ ok: boolean; error?: string }> {
  if (!client) return { ok: false, error: 'Client Supabase non connecté.' };

  const cleanEmail = String(sender.from_email || '').trim();
  const cleanReplyTo = String(sender.reply_to || '').trim();

  if (cleanEmail && !isValidEmailAddress(cleanEmail)) {
    return {
      ok: false,
      error: `Format d'adresse d'expéditeur invalide pour "${sender.app_code}" : ${cleanEmail}`,
    };
  }
  if (cleanReplyTo && !isValidEmailAddress(cleanReplyTo)) {
    return {
      ok: false,
      error: `Format d'adresse Reply-To invalide pour "${sender.app_code}" : ${cleanReplyTo}`,
    };
  }

  const { error } = await client.from(TABLES.mailSenders).upsert(
    [
      {
        app_code: sender.app_code,
        from_name: String(sender.from_name || '').trim() || 'TOT Suite',
        from_email: cleanEmail,
        reply_to: cleanReplyTo || null,
        account_id: sender.account_id || null,
        updated_at: new Date().toISOString(),
      },
    ],
    { onConflict: 'app_code' }
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function fetchMailLogEntries(
  client: any,
  filters?: { appCode?: string; status?: string; limit?: number }
): Promise<MailLogRecord[]> {
  if (!client) return [];
  const limit = filters?.limit || 100;
  let query = client
    .from(TABLES.mailLog)
    .select(
      'id, created_at, app_code, account_id, provider, sender_email, recipient_masked, recipient_count, subject, kind, status, message_id, error_message, user_id'
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (filters?.appCode && filters.appCode !== 'all') {
    query = query.eq('app_code', filters.appCode);
  }
  if (filters?.status && filters.status !== 'all') {
    query = query.eq('status', filters.status);
  }

  const { data, error } = await query;
  if (error || !Array.isArray(data)) return [];
  return data as MailLogRecord[];
}

export async function purgeMailLogsOlderThan(
  client: any,
  days = 90
): Promise<{ ok: boolean; deletedCount?: number; error?: string }> {
  if (!client) return { ok: false, error: 'Client Supabase non connecté.' };
  const { data, error } = await client.rpc('purge_mail_log', { p_days: days });
  if (error) return { ok: false, error: error.message };
  return { ok: true, deletedCount: Number(data || 0) };
}

export async function sendTestEmailRequest(
  client: any,
  params: { to: string; appCode?: string }
): Promise<{
  ok: boolean;
  message: string;
  statusCode?: number;
  provider?: string;
  fromEmail?: string;
}> {
  const target = String(params.to || '').trim();
  if (!isValidEmailAddress(target)) {
    return {
      ok: false,
      message: 'Veuillez saisir une adresse e-mail destinataire valide pour le test.',
    };
  }
  if (!client || typeof client.functions?.invoke !== 'function') {
    return {
      ok: false,
      message: 'Connexion Supabase requise pour appeler la fonction Edge send-report-email.',
    };
  }

  const fnName = getResolvedEdgeFunctionName('sendReportEmail');
  const appCode = params.appCode || CURRENT_MAIL_APP_CODE;

  try {
    const { data, error } = await client.functions.invoke(fnName, {
      body: {
        app_code: appCode,
        to: target,
        test: true,
      },
    });

    if (error) {
      const parsed = await extractEdgeFunctionError(error, data);
      return {
        ok: false,
        message: parsed.message,
        statusCode: parsed.statusCode,
      };
    }
    if (!data?.success) {
      const safeError = redactClientSecrets(
        String(data?.error || 'Échec lors du test d’envoi e-mail.')
      );
      return {
        ok: false,
        message: safeError,
      };
    }

    try {
      localStorage.setItem('tot_email_service_configured', 'true');
      window.dispatchEvent(
        new CustomEvent('tot-email-service-status', { detail: { configured: true } })
      );
    } catch {
      // Ignorer
    }

    return {
      ok: true,
      message:
        data.message ||
        `E-mail de test envoyé avec succès à ${target}.`,
      provider: data.provider,
      fromEmail: data.from_email,
    };
  } catch (err: any) {
    const parsed = await extractEdgeFunctionError(err);
    return {
      ok: false,
      message: parsed.message || "Impossible de joindre la fonction Edge d'envoi d'e-mails.",
      statusCode: parsed.statusCode,
    };
  }
}
