export type MailProviderType =
  | 'brevo'
  | 'resend'
  | 'sendgrid'
  | 'mailgun'
  | 'postmark'
  | 'mailjet'
  | 'smtp'
  | 'msgraph';

export type SmtpEncryptionType = 'ssl' | 'starttls' | 'none';

export const MSGRAPH_MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024; // 3 Mo max en v1
export const MSGRAPH_MAX_TOKEN_CACHE_MS = 50 * 60 * 1000; // <= 50 minutes

export interface ResolvedMailConfig {
  configured: boolean;
  legacy?: boolean;
  reason?: string;
  config_error?: string;
  account_id?: string | null;
  account_name?: string | null;
  provider?: MailProviderType;
  preset?: string | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_encryption?: SmtpEncryptionType | null;
  smtp_username?: string | null;
  host?: string | null;
  port?: number | null;
  encryption?: SmtpEncryptionType | null;
  username?: string | null;
  secret?: string | null;
  extra?: Record<string, any> | null;
  app_code?: string;
  from_name?: string;
  from_email?: string;
  reply_to?: string | null;
}

export interface MailAttachmentInput {
  filename: string;
  contentBase64: string;
  contentType?: string;
}

export interface MailDispatchMessage {
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
  to: string[];
  subject: string;
  htmlContent: string;
  attachments?: MailAttachmentInput[];
}

export interface MailProviderResult {
  ok: boolean;
  provider: MailProviderType;
  messageId?: string;
  statusCode?: number;
  retryAfterSeconds?: number;
  error?: string;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type SmtpTransportFn = (
  config: ResolvedMailConfig,
  message: MailDispatchMessage
) => Promise<{ ok: boolean; messageId?: string; error?: string }>;

interface MsGraphCachedToken {
  accessToken: string;
  expiresAt: number;
}

const msGraphTokenCache = new Map<string, MsGraphCachedToken>();

export function clearMsGraphTokenCache(): void {
  msGraphTokenCache.clear();
}

/**
 * Masque une adresse e-mail pour le journal RGPD : "jean.dupont@domaine.fr" -> "j***@domaine.fr"
 */
export function maskEmailRecipient(email: string): string {
  const trimmed = String(email || '').trim().toLowerCase();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return '***@***';
  }
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  return `${local[0]}***@${domain}`;
}

export function maskEmailRecipientList(recipients: string[]): string {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return '***@***';
  }
  const first = maskEmailRecipient(recipients[0]);
  if (recipients.length === 1) return first;
  return `${first} (+${recipients.length - 1})`;
}

export function redactSecretsFromText(
  rawText: string,
  secretsToRedact?: Array<string | null | undefined>
): string {
  let msg = String(rawText || '');
  if (Array.isArray(secretsToRedact)) {
    for (const sec of secretsToRedact) {
      if (sec && sec.trim().length >= 4) {
        const escaped = sec.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        msg = msg.replace(new RegExp(escaped, 'g'), '[SECRET_MASQUÉ]');
      }
    }
  }
  msg = msg
    .replace(/xkeysib-[a-zA-Z0-9_-]+/gi, '[SECRET_MASQUÉ]')
    .replace(/\bre_[a-zA-Z0-9_-]{8,}/g, '[SECRET_MASQUÉ]')
    .replace(/\bSG\.[a-zA-Z0-9_.-]{10,}/g, '[SECRET_MASQUÉ]')
    .replace(/Bearer\s+[a-zA-Z0-9_~+/=-]{12,}/gi, 'Bearer [SECRET_MASQUÉ]');
  return msg;
}

/**
 * Normalise en français les erreurs spécifiques à Microsoft 365 (Graph) sans jamais exposer le secret ni le jeton.
 */
export function normalizeMsGraphError(
  rawError: unknown,
  statusCode?: number,
  extraContext?: {
    errorCode?: string;
    fromEmail?: string;
    retryAfter?: string | null;
    secretsToRedact?: Array<string | null | undefined>;
  }
): string {
  const rawStr =
    typeof rawError === 'string'
      ? rawError
      : rawError && typeof (rawError as any).message === 'string'
      ? (rawError as any).message
      : 'Erreur Microsoft 365 (Graph)';

  const msg = redactSecretsFromText(rawStr, extraContext?.secretsToRedact);
  const code = redactSecretsFromText(String(extraContext?.errorCode || ''), extraContext?.secretsToRedact);
  const combinedLower = `${code} ${msg}`.toLowerCase();
  const mailboxHint = extraContext?.fromEmail ? ` (${extraContext.fromEmail})` : '';

  if (
    statusCode === 401 ||
    combinedLower.includes('invalid_client') ||
    combinedLower.includes('aadsts7000215') ||
    combinedLower.includes('aadsts7000222') ||
    combinedLower.includes('invalidauthenticationtoken') ||
    combinedLower.includes('unauthorized')
  ) {
    return "Authentification Microsoft 365 (Graph) refusée : secret expiré ou incorrect (vérifiez la valeur du secret client Entra ID et sa date d'expiration).";
  }

  if (
    statusCode === 403 ||
    combinedLower.includes('erroraccessdenied') ||
    combinedLower.includes('accessdenied') ||
    combinedLower.includes('authorization_requestdenied') ||
    combinedLower.includes('insufficient privileges')
  ) {
    return `Accès refusé par Microsoft 365 (Graph) : consentement administrateur manquant ou boîte non autorisée par la stratégie d'accès de l'application${mailboxHint}.`;
  }

  if (
    statusCode === 404 ||
    combinedLower.includes('errorinvaliduser') ||
    combinedLower.includes('resourcenotfound') ||
    combinedLower.includes('request_resourcenotfound') ||
    combinedLower.includes('mailboxnotenabledforrestapi') ||
    combinedLower.includes('errornonexistentmailbox')
  ) {
    return `Envoi Microsoft 365 (Graph) impossible : boîte aux lettres introuvable dans ce tenant${mailboxHint}.`;
  }

  if (statusCode === 429 || combinedLower.includes('too many requests') || combinedLower.includes('throttled')) {
    const retrySec = extraContext?.retryAfter ? String(extraContext.retryAfter).trim() : '';
    return retrySec
      ? `Envoi Microsoft 365 (Graph) suspendu (HTTP 429) : limite de débit Microsoft atteinte, veuillez réessayer après ${retrySec} s (Retry-After).`
      : 'Envoi Microsoft 365 (Graph) suspendu (HTTP 429) : limite de débit Microsoft atteinte, réessayez plus tard.';
  }

  if (combinedLower.includes('aadsts700016') || combinedLower.includes('unauthorized_client')) {
    return "Application Microsoft 365 (Graph) introuvable dans ce tenant : vérifiez le Tenant ID et le Client ID (Application ID).";
  }

  if (combinedLower.includes('aadsts90002')) {
    return "Tenant Microsoft 365 introuvable : vérifiez l'identifiant du tenant (GUID ou domaine).";
  }

  return `Échec Microsoft 365 (Graph)${statusCode ? ` (HTTP ${statusCode})` : ''} : ${msg}`;
}

/**
 * Supprime toute occurrence accidentelle d'un secret ou jeton dans un message d'erreur
 * et traduit les erreurs techniques courantes en français clair.
 */
export function sanitizeAndTranslateMailError(
  rawError: unknown,
  statusCode?: number,
  provider?: string,
  secretToRedact?: string | null
): string {
  const rawStr =
    typeof rawError === 'string'
      ? rawError
      : rawError && typeof (rawError as any).message === 'string'
      ? (rawError as any).message
      : 'Erreur lors de la communication avec le service e-mail.';

  const msg = redactSecretsFromText(rawStr, [secretToRedact]);

  if (provider === 'msgraph') {
    if (
      msg.startsWith('Authentification Microsoft 365 (Graph)') ||
      msg.startsWith('Accès refusé par Microsoft 365 (Graph)') ||
      msg.startsWith('Envoi Microsoft 365 (Graph) impossible') ||
      msg.startsWith('Limitation Microsoft 365 (Graph)') ||
      msg.startsWith('La taille totale des pièces jointes dépasse la limite de 3 Mo')
    ) {
      return msg;
    }
    return normalizeMsGraphError(msg, statusCode, { secretsToRedact: [secretToRedact] });
  }

  const lower = msg.toLowerCase();
  const label = provider ? provider.toUpperCase() : 'Fournisseur';

  if (
    statusCode === 401 ||
    statusCode === 403 ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key') ||
    lower.includes('authentication failed') ||
    lower.includes('535 ')
  ) {
    return `Authentification refusée par ${label} : clé API ou mot de passe d'application invalide.`;
  }
  if (
    statusCode === 429 ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('quota')
  ) {
    return `Limite d'envoi ou quota dépassé chez ${label}. Réessayez plus tard.`;
  }
  if (
    statusCode === 422 ||
    lower.includes('sender') ||
    lower.includes('from address') ||
    lower.includes('not verified') ||
    lower.includes('domain is not verified')
  ) {
    return `Adresse d'expéditeur refusée par ${label} : vérifiez que l'adresse et son domaine sont validés chez le fournisseur (${msg}).`;
  }
  if (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound')
  ) {
    return `Impossible de joindre le serveur ${label} (délai dépassé ou hôte inaccessible).`;
  }

  return `Échec d'envoi ${label}${statusCode ? ` (HTTP ${statusCode})` : ''} : ${msg}`;
}

function encodeBase64Ascii(value: string): string {
  if (typeof btoa === 'function') {
    return btoa(value);
  }
  const B = (globalThis as any).Buffer;
  if (B) {
    return B.from(value, 'utf8').toString('base64');
  }
  throw new Error('Encodage Base64 indisponible');
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return encodeBase64Ascii(binary);
}

export function estimateAttachmentsBytes(attachments?: MailAttachmentInput[]): number {
  if (!Array.isArray(attachments) || attachments.length === 0) return 0;
  let total = 0;
  for (const att of attachments) {
    const b64 = String(att?.contentBase64 || '').trim().replace(/\s+/g, '');
    if (!b64) continue;
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    total += Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
  }
  return total;
}

/**
 * Client SMTP minimaliste autonome pour Deno Edge Functions (SSL/TLS port 465 ou STARTTLS port 587).
 * Refuse explicitement le port 25 (bloqué dans les environnements cloud / Supabase Edge).
 */
export async function sendSmtpNativeDeno(
  config: ResolvedMailConfig,
  message: MailDispatchMessage
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const host = String(config.smtp_host || config.host || '').trim();
  const port = Number(config.smtp_port || config.port || 587);
  const encryption: SmtpEncryptionType =
    ((config.smtp_encryption || config.encryption) as SmtpEncryptionType) ||
    (port === 465 ? 'ssl' : 'starttls');
  const username = String(config.smtp_username || config.username || '').trim();
  const secret = String(config.secret || '');

  if (!host) {
    return { ok: false, error: 'Hôte SMTP manquant dans la configuration du compte.' };
  }
  if (port === 25) {
    return {
      ok: false,
      error:
        "Port SMTP 25 non pris en charge par l'environnement Edge Functions (bloqué contre le spam). Utilisez le port 587 (STARTTLS) ou 465 (SSL/TLS).",
    };
  }

  const denoObj = (globalThis as any).Deno;
  if (!denoObj || typeof denoObj.connect !== 'function') {
    return {
      ok: false,
      error: "Connexion TCP/SMTP directe indisponible dans cet environnement d'exécution.",
    };
  }

  let conn: any = null;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const readLine = async (c: any): Promise<string> => {
    const buf = new Uint8Array(4096);
    let accumulated = '';
    while (true) {
      const n = await c.read(buf);
      if (n === null) break;
      accumulated += decoder.decode(buf.subarray(0, n));
      const lines = accumulated.split('\r\n').filter(Boolean);
      const lastLine = lines[lines.length - 1] || '';
      if (/^\d{3} /.test(lastLine)) {
        return accumulated;
      }
    }
    return accumulated;
  };

  const sendCmd = async (c: any, cmd: string, expectedPrefix = '2'): Promise<string> => {
    await c.write(encoder.encode(`${cmd}\r\n`));
    const resp = await readLine(c);
    if (!resp.startsWith(expectedPrefix)) {
      throw new Error(`Réponse SMTP inattendue (${resp.trim()})`);
    }
    return resp;
  };

  try {
    if (encryption === 'ssl') {
      conn = await denoObj.connectTls({ hostname: host, port });
    } else {
      conn = await denoObj.connect({ hostname: host, port });
    }

    const banner = await readLine(conn);
    if (!banner.startsWith('220')) {
      throw new Error(`Bannière SMTP invalide : ${banner.trim()}`);
    }

    await sendCmd(conn, `EHLO tot-stock.local`, '250');

    if (encryption === 'starttls') {
      await sendCmd(conn, 'STARTTLS', '220');
      if (typeof denoObj.startTls !== 'function') {
        throw new Error('Deno.startTls non supporté dans ce runtime ; privilégiez SSL/TLS sur le port 465.');
      }
      conn = await denoObj.startTls(conn, { hostname: host });
      await sendCmd(conn, `EHLO tot-stock.local`, '250');
    }

    if (username) {
      await sendCmd(conn, 'AUTH LOGIN', '334');
      await sendCmd(conn, encodeBase64Ascii(username), '334');
      await sendCmd(conn, encodeBase64Ascii(secret), '235');
    }

    await sendCmd(conn, `MAIL FROM:<${message.fromEmail}>`, '250');
    for (const rcpt of message.to) {
      await sendCmd(conn, `RCPT TO:<${rcpt}>`, '250');
    }

    await sendCmd(conn, 'DATA', '354');

    const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2, 10)}@${
      message.fromEmail.split('@')[1] || 'tot-stock.local'
    }>`;
    const encodedSubject = `=?UTF-8?B?${encodeBase64Utf8(message.subject)}?=`;
    const encodedFromName = `=?UTF-8?B?${encodeBase64Utf8(message.fromName)}?=`;

    const headers = [
      `Message-ID: ${msgId}`,
      `Date: ${new Date().toUTCString()}`,
      `From: ${encodedFromName} <${message.fromEmail}>`,
      `To: ${message.to.join(', ')}`,
      ...(message.replyTo ? [`Reply-To: ${message.replyTo}`] : []),
      `Subject: ${encodedSubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
    ];

    const bodyBase64 = encodeBase64Utf8(message.htmlContent).replace(/(.{76})/g, '$1\r\n');
    const mimePayload = `${headers.join('\r\n')}\r\n\r\n${bodyBase64}\r\n.`;

    await sendCmd(conn, mimePayload, '250');
    try {
      await sendCmd(conn, 'QUIT', '221');
    } catch {
      // Ignorer la fermeture
    }
    try {
      conn.close();
    } catch {
      // Ignorer
    }

    return { ok: true, messageId: msgId };
  } catch (err: any) {
    if (conn) {
      try {
        conn.close();
      } catch {
        // Ignorer
      }
    }
    return {
      ok: false,
      error: sanitizeAndTranslateMailError(err, undefined, 'smtp', secret),
    };
  }
}

/**
 * Envoie un e-mail via le fournisseur configuré dans `core_mail_accounts`.
 */
export async function sendMailWithProvider(
  config: ResolvedMailConfig,
  message: MailDispatchMessage,
  customFetch: FetchLike = fetch,
  customSmtpSend?: SmtpTransportFn
): Promise<MailProviderResult> {
  const provider: MailProviderType = (config.provider || 'brevo') as MailProviderType;
  const secret = String(config.secret || '').trim();

  if (!secret) {
    return {
      ok: false,
      provider,
      error: 'Aucun secret (clé API ou mot de passe SMTP) configuré pour ce compte.',
    };
  }

  try {
    switch (provider) {
      case 'brevo': {
        const payload: Record<string, any> = {
          sender: {
            name: message.fromName,
            email: message.fromEmail,
          },
          to: message.to.map((email) => ({ email })),
          subject: message.subject,
          htmlContent: message.htmlContent,
        };
        if (message.replyTo) {
          payload.replyTo = { email: message.replyTo };
        }
        if (Array.isArray(message.attachments) && message.attachments.length > 0) {
          payload.attachment = message.attachments.map((att) => ({
            name: att.filename,
            content: att.contentBase64,
          }));
        }

        const resp = await customFetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'api-key': secret,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        const data: any = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          return {
            ok: false,
            provider,
            statusCode: resp.status,
            error: sanitizeAndTranslateMailError(
              data?.message || data?.error || `HTTP ${resp.status}`,
              resp.status,
              'brevo',
              secret
            ),
          };
        }
        return {
          ok: true,
          provider,
          statusCode: resp.status,
          messageId: data?.messageId || data?.id || 'brevo-ok',
        };
      }

      case 'resend': {
        const payload: Record<string, any> = {
          from: `${message.fromName} <${message.fromEmail}>`,
          to: message.to,
          subject: message.subject,
          html: message.htmlContent,
        };
        if (message.replyTo) {
          payload.reply_to = message.replyTo;
        }
        if (Array.isArray(message.attachments) && message.attachments.length > 0) {
          payload.attachments = message.attachments.map((att) => ({
            filename: att.filename,
            content: att.contentBase64,
          }));
        }

        const resp = await customFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        const data: any = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          return {
            ok: false,
            provider,
            statusCode: resp.status,
            error: sanitizeAndTranslateMailError(
              data?.message || data?.error?.message || `HTTP ${resp.status}`,
              resp.status,
              'resend',
              secret
            ),
          };
        }
        return {
          ok: true,
          provider,
          statusCode: resp.status,
          messageId: data?.id || 'resend-ok',
        };
      }

      case 'sendgrid': {
        const payload: Record<string, any> = {
          personalizations: [
            {
              to: message.to.map((email) => ({ email })),
            },
          ],
          from: {
            email: message.fromEmail,
            name: message.fromName,
          },
          subject: message.subject,
          content: [
            {
              type: 'text/html',
              value: message.htmlContent,
            },
          ],
        };
        if (message.replyTo) {
          payload.reply_to = { email: message.replyTo };
        }
        if (Array.isArray(message.attachments) && message.attachments.length > 0) {
          payload.attachments = message.attachments.map((att) => ({
            filename: att.filename,
            content: att.contentBase64,
            type: att.contentType || 'application/octet-stream',
            disposition: 'attachment',
          }));
        }

        const resp = await customFetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          const data: any = await resp.json().catch(() => ({}));
          const errDetail =
            data?.errors?.[0]?.message || data?.message || `HTTP ${resp.status}`;
          return {
            ok: false,
            provider,
            statusCode: resp.status,
            error: sanitizeAndTranslateMailError(errDetail, resp.status, 'sendgrid', secret),
          };
        }
        const msgId =
          resp.headers?.get?.('x-message-id') || 'sendgrid-accepted';
        return {
          ok: true,
          provider,
          statusCode: resp.status,
          messageId: msgId,
        };
      }

      case 'mailgun': {
        const extra = config.extra && typeof config.extra === 'object' ? config.extra : {};
        const domain = String(
          extra.domain || config.host || message.fromEmail.split('@')[1] || ''
        ).trim();
        const region = String(extra.region || 'eu').toLowerCase() === 'us' ? 'us' : 'eu';
        if (!domain) {
          return {
            ok: false,
            provider,
            error: "Domaine d'envoi Mailgun manquant dans la configuration du compte.",
          };
        }
        const baseUrl =
          region === 'eu'
            ? `https://api.eu.mailgun.net/v3/${encodeURIComponent(domain)}/messages`
            : `https://api.mailgun.net/v3/${encodeURIComponent(domain)}/messages`;

        const formParams = new URLSearchParams();
        formParams.set('from', `${message.fromName} <${message.fromEmail}>`);
        for (const rcpt of message.to) {
          formParams.append('to', rcpt);
        }
        formParams.set('subject', message.subject);
        formParams.set('html', message.htmlContent);
        if (message.replyTo) {
          formParams.set('h:Reply-To', message.replyTo);
        }

        const authHeader = `Basic ${encodeBase64Ascii(`api:${secret}`)}`;
        const resp = await customFetch(baseUrl, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formParams.toString(),
        });
        const data: any = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          return {
            ok: false,
            provider,
            statusCode: resp.status,
            error: sanitizeAndTranslateMailError(
              data?.message || `HTTP ${resp.status}`,
              resp.status,
              'mailgun',
              secret
            ),
          };
        }
        return {
          ok: true,
          provider,
          statusCode: resp.status,
          messageId: data?.id || 'mailgun-ok',
        };
      }

      case 'postmark': {
        const payload: Record<string, any> = {
          From: `${message.fromName} <${message.fromEmail}>`,
          To: message.to.join(','),
          Subject: message.subject,
          HtmlBody: message.htmlContent,
          MessageStream: (config.extra && config.extra.messageStream) || 'outbound',
        };
        if (message.replyTo) {
          payload.ReplyTo = message.replyTo;
        }
        if (Array.isArray(message.attachments) && message.attachments.length > 0) {
          payload.Attachments = message.attachments.map((att) => ({
            Name: att.filename,
            Content: att.contentBase64,
            ContentType: att.contentType || 'application/octet-stream',
          }));
        }

        const resp = await customFetch('https://api.postmarkapp.com/email', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Postmark-Server-Token': secret,
          },
          body: JSON.stringify(payload),
        });
        const data: any = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          return {
            ok: false,
            provider,
            statusCode: resp.status,
            error: sanitizeAndTranslateMailError(
              data?.Message || `HTTP ${resp.status}`,
              resp.status,
              'postmark',
              secret
            ),
          };
        }
        return {
          ok: true,
          provider,
          statusCode: resp.status,
          messageId: data?.MessageID || 'postmark-ok',
        };
      }

      case 'mailjet': {
        const apiKeyPublic = String(
          config.smtp_username || config.username || (config.extra && config.extra.apiKeyPublic) || ''
        ).trim();
        if (!apiKeyPublic) {
          return {
            ok: false,
            provider,
            error: "Clé API publique Mailjet (identifiant) manquante dans la configuration du compte.",
          };
        }
        const msgObj: Record<string, any> = {
          From: {
            Email: message.fromEmail,
            Name: message.fromName,
          },
          To: message.to.map((Email) => ({ Email })),
          Subject: message.subject,
          HTMLPart: message.htmlContent,
        };
        if (message.replyTo) {
          msgObj.ReplyTo = { Email: message.replyTo };
        }
        if (Array.isArray(message.attachments) && message.attachments.length > 0) {
          msgObj.Attachments = message.attachments.map((att) => ({
            Filename: att.filename,
            Base64Content: att.contentBase64,
            ContentType: att.contentType || 'application/octet-stream',
          }));
        }

        const authHeader = `Basic ${encodeBase64Ascii(`${apiKeyPublic}:${secret}`)}`;
        const resp = await customFetch('https://api.mailjet.com/v3.1/send', {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ Messages: [msgObj] }),
        });
        const data: any = await resp.json().catch(() => ({}));
        const firstStatus = data?.Messages?.[0]?.Status;
        if (!resp.ok || firstStatus === 'error') {
          const errMsg =
            data?.Messages?.[0]?.Errors?.[0]?.ErrorMessage ||
            data?.ErrorMessage ||
            `HTTP ${resp.status}`;
          return {
            ok: false,
            provider,
            statusCode: resp.status,
            error: sanitizeAndTranslateMailError(errMsg, resp.status, 'mailjet', secret),
          };
        }
        return {
          ok: true,
          provider,
          statusCode: resp.status,
          messageId:
            String(data?.Messages?.[0]?.To?.[0]?.MessageUUID || '') || 'mailjet-ok',
        };
      }

      case 'msgraph': {
        const extra = config.extra && typeof config.extra === 'object' ? config.extra : {};
        const tenantId = String(extra.tenant_id || '').trim();
        const clientId = String(extra.client_id || '').trim();

        if (!tenantId || !clientId) {
          return {
            ok: false,
            provider: 'msgraph',
            statusCode: 400,
            error:
              "Configuration Microsoft 365 (Graph) incomplète : les champs Tenant ID et Client ID sont obligatoires.",
          };
        }

        const totalAttBytes = estimateAttachmentsBytes(message.attachments);
        if (totalAttBytes > MSGRAPH_MAX_ATTACHMENT_BYTES) {
          return {
            ok: false,
            provider: 'msgraph',
            statusCode: 400,
            error:
              "La taille totale des pièces jointes dépasse la limite de 3 Mo autorisée par Microsoft 365 (Graph) en envoi direct.",
          };
        }

        const cacheKey = `${tenantId.toLowerCase()}::${clientId.toLowerCase()}::${secret.slice(0, 4)}_${secret.length}`;
        const now = Date.now();
        let accessToken = '';
        const cached = msGraphTokenCache.get(cacheKey);

        if (cached && cached.expiresAt > now && cached.accessToken) {
          accessToken = cached.accessToken;
        } else {
          const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
            tenantId
          )}/oauth2/v2.0/token`;
          const tokenForm = new URLSearchParams();
          tokenForm.set('client_id', clientId);
          tokenForm.set('client_secret', secret);
          tokenForm.set('scope', 'https://graph.microsoft.com/.default');
          tokenForm.set('grant_type', 'client_credentials');

          const tokenResp = await customFetch(tokenUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: tokenForm.toString(),
          });

          const tokenData: any = await tokenResp.json().catch(() => ({}));
          if (!tokenResp.ok || !tokenData?.access_token) {
            const oauthErrCode = String(tokenData?.error || '');
            const oauthErrDesc = String(
              tokenData?.error_description || tokenData?.error || `HTTP ${tokenResp.status}`
            );
            const effectiveStatus =
              oauthErrCode === 'invalid_client' || oauthErrDesc.includes('AADSTS7000215')
                ? 401
                : tokenResp.status || 401;
            return {
              ok: false,
              provider: 'msgraph',
              statusCode: effectiveStatus,
              error: normalizeMsGraphError(oauthErrDesc, effectiveStatus, {
                errorCode: oauthErrCode,
                fromEmail: message.fromEmail,
                secretsToRedact: [secret],
              }),
            };
          }

          accessToken = String(tokenData.access_token);
          const expiresInSec = Number(tokenData.expires_in || 3600);
          const safeTtlMs = Math.min(
            Math.max(60, expiresInSec - 300) * 1000,
            MSGRAPH_MAX_TOKEN_CACHE_MS
          );
          msGraphTokenCache.set(cacheKey, {
            accessToken,
            expiresAt: now + safeTtlMs,
          });
        }

        const graphMessage: Record<string, any> = {
          subject: message.subject,
          body: {
            contentType: 'HTML',
            content: message.htmlContent,
          },
          toRecipients: message.to.map((address) => ({
            emailAddress: { address },
          })),
        };
        if (message.replyTo) {
          graphMessage.replyTo = [{ emailAddress: { address: message.replyTo } }];
        }
        if (Array.isArray(message.attachments) && message.attachments.length > 0) {
          graphMessage.attachments = message.attachments.map((att) => ({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: att.filename,
            contentType: att.contentType || 'application/octet-stream',
            contentBytes: att.contentBase64,
          }));
        }

        const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
          message.fromEmail
        )}/sendMail`;
        const sendResp = await customFetch(sendUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: graphMessage,
            saveToSentItems: true,
          }),
        });

        if (sendResp.status !== 202 && !sendResp.ok) {
          if (sendResp.status === 401) {
            msGraphTokenCache.delete(cacheKey);
          }
          const errData: any = await sendResp.json().catch(() => ({}));
          const graphErrCode = String(errData?.error?.code || errData?.error || '');
          const graphErrMsg = String(
            errData?.error?.message || errData?.message || `HTTP ${sendResp.status}`
          );
          const retryAfter =
            sendResp.headers?.get?.('Retry-After') ||
            sendResp.headers?.get?.('retry-after') ||
            null;
          const retrySec = retryAfter && /^\d+$/.test(retryAfter.trim())
            ? Number(retryAfter.trim())
            : undefined;

          return {
            ok: false,
            provider: 'msgraph',
            statusCode: sendResp.status,
            retryAfterSeconds: retrySec,
            error: normalizeMsGraphError(graphErrMsg, sendResp.status, {
              errorCode: graphErrCode,
              fromEmail: message.fromEmail,
              retryAfter,
              secretsToRedact: [secret, accessToken],
            }),
          };
        }

        const reqId =
          sendResp.headers?.get?.('request-id') ||
          sendResp.headers?.get?.('client-request-id') ||
          'msgraph-202';

        return {
          ok: true,
          provider: 'msgraph',
          statusCode: sendResp.status || 202,
          messageId: reqId,
        };
      }

      case 'smtp': {
        const smtpPort = Number(config.smtp_port ?? config.port);
        if (smtpPort === 25) {
          return {
            ok: false,
            provider: 'smtp',
            statusCode: 400,
            error:
              "Port SMTP 25 non pris en charge par l'environnement Edge Functions (bloqué contre le spam). Utilisez le port 587 (STARTTLS) ou 465 (SSL/TLS).",
          };
        }
        const transport = customSmtpSend || sendSmtpNativeDeno;
        const smtpRes = await transport(config, message);
        if (!smtpRes.ok) {
          return {
            ok: false,
            provider: 'smtp',
            statusCode: 502,
            error: sanitizeAndTranslateMailError(
              smtpRes.error || 'Échec de transmission SMTP',
              undefined,
              'smtp',
              secret
            ),
          };
        }
        return {
          ok: true,
          provider: 'smtp',
          statusCode: 200,
          messageId: smtpRes.messageId || 'smtp-ok',
        };
      }

      default:
        return {
          ok: false,
          provider,
          error: `Fournisseur d'e-mail non reconnu : ${String(provider)}`,
        };
    }
  } catch (err: any) {
    return {
      ok: false,
      provider,
      error: sanitizeAndTranslateMailError(err, undefined, provider, secret),
    };
  }
}
