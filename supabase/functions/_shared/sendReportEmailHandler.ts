import { handleCorsPreflight, jsonResponse } from "./cors.ts";
import { authenticateCaller, AuthenticatedCallerContext } from "./auth.ts";
import { readEmailSecretConfig, CLIENT_EDGE_FUNCTIONS, TABLES } from "./config.ts";
import {
  FetchLike,
  MailAttachmentInput,
  ResolvedMailConfig,
  SmtpTransportFn,
  maskEmailRecipientList,
  sanitizeAndTranslateMailError,
  sendMailWithProvider,
} from "./mailProviders.ts";

export const MAX_RECIPIENTS_PER_CALL = 20;
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_EMAIL_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 Mo
export const MAX_EMAILS_PER_USER_PER_HOUR = 30;

const EMAIL_VALIDATION_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SendReportEmailDeps {
  authenticate?: (
    req: Request
  ) => Promise<{ ok: true; ctx: AuthenticatedCallerContext } | { ok: false; response: Response }>;
  fetchFn?: FetchLike;
  smtpTransport?: SmtpTransportFn;
  maxPerHour?: number;
}

export function normalizeAppCode(rawAppCode: unknown): string {
  const cleaned = String(rawAppCode || 'stk')
    .trim()
    .toLowerCase();
  if (!cleaned || !/^[a-z0-9_-]{2,16}$/.test(cleaned)) {
    return 'stk';
  }
  return cleaned;
}

export function parseAndValidateRecipients(rawTo: unknown): {
  ok: true;
  recipients: string[];
} | {
  ok: false;
  error: string;
} {
  const list: string[] = [];
  if (typeof rawTo === 'string') {
    const parts = rawTo
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    list.push(...parts);
  } else if (Array.isArray(rawTo)) {
    for (const item of rawTo) {
      if (typeof item === 'string' && item.trim()) {
        list.push(item.trim());
      }
    }
  }

  const unique = Array.from(new Set(list));
  if (unique.length === 0) {
    return {
      ok: false,
      error: 'Destinataire manquant : au moins une adresse e-mail valide est requise dans "to".',
    };
  }
  if (unique.length > MAX_RECIPIENTS_PER_CALL) {
    return {
      ok: false,
      error: `Nombre maximal de destinataires dépassé (${unique.length}/${MAX_RECIPIENTS_PER_CALL} max par envoi).`,
    };
  }
  for (const addr of unique) {
    if (addr.length > 254 || !EMAIL_VALIDATION_REGEX.test(addr)) {
      return {
        ok: false,
        error: `Adresse e-mail destinataire invalide : "${addr}".`,
      };
    }
  }
  return { ok: true, recipients: unique };
}

/**
 * Lit la configuration d'envoi depuis la RPC `public.get_mail_config(p_app_code)` (exécutable par service_role uniquement).
 * Si `get_mail_config` renvoie une erreur (ex. Accès refusé / Vault / permission), ne retombe PAS silencieusement
 * sur « non configuré » : journalise l'erreur et renvoie `config_error: "Lecture de la configuration e-mail refusée : <message>"`.
 * Le repli sur `readEmailSecretConfig` n'est utilisé que si la fonction RPC `get_mail_config` n'existe pas encore (base N-1 avant script 14).
 */
export async function resolveServerMailConfig(
  supabaseAdmin: any,
  appCode: string
): Promise<ResolvedMailConfig> {
  try {
    const { data, error } = await supabaseAdmin.rpc('get_mail_config', {
      p_app_code: appCode,
    });
    if (error) {
      const rawErrMsg = String(error.message || error.details || error || '').trim();
      const isMissingRpc =
        error.code === '42883' ||
        error.code === 'PGRST202' ||
        /function .*get_mail_config.* does not exist|Could not find the function/i.test(rawErrMsg);

      if (!isMissingRpc) {
        const cleanErr = sanitizeAndTranslateMailError(rawErrMsg || 'Erreur RPC get_mail_config');
        const explicitMsg = `Lecture de la configuration e-mail refusée : ${rawErrMsg || cleanErr}`;
        console.error('[send-report-email]', explicitMsg);
        return {
          configured: false,
          config_error: explicitMsg,
          app_code: appCode,
        };
      }
    } else if (data && typeof data === 'object') {
      const cfg = data as ResolvedMailConfig;
      // En mode legacy (aucun compte dans core_mail_accounts), compléter éventuellement avec BREVO_API_KEY d'env
      if (!cfg.configured && cfg.legacy) {
        const fallback = await readEmailSecretConfig(supabaseAdmin);
        if (fallback.configured && fallback.apiKey) {
          return {
            configured: true,
            legacy: true,
            provider: 'brevo',
            preset: 'brevo',
            secret: fallback.apiKey,
            app_code: appCode,
            from_name: cfg.from_name || fallback.senderName || 'TOT Stock',
            from_email: cfg.from_email || fallback.senderEmail || 'no-reply@tot-stock.pro',
            reply_to: cfg.reply_to || null,
          };
        }
      }
      return {
        ...cfg,
        app_code: cfg.app_code || appCode,
        from_name: String(cfg.from_name || 'TOT Stock').trim(),
        from_email: String(cfg.from_email || 'no-reply@tot-stock.pro').trim(),
      };
    }
  } catch (err: any) {
    const rawErrMsg = String(err?.message || err || '').trim();
    const isMissingRpc =
      /function .*get_mail_config.* does not exist|Could not find the function/i.test(rawErrMsg);
    if (!isMissingRpc && rawErrMsg) {
      const explicitMsg = `Lecture de la configuration e-mail refusée : ${rawErrMsg}`;
      console.error('[send-report-email]', explicitMsg);
      return {
        configured: false,
        config_error: explicitMsg,
        app_code: appCode,
      };
    }
  }

  const fallback = await readEmailSecretConfig(supabaseAdmin);
  return {
    configured: Boolean(fallback.configured && fallback.apiKey),
    legacy: true,
    provider: 'brevo',
    preset: 'brevo',
    secret: fallback.apiKey,
    app_code: appCode,
    from_name: fallback.senderName || 'TOT Stock',
    from_email: fallback.senderEmail || 'no-reply@tot-stock.pro',
    reply_to: null,
  };
}

export const VALID_MAIL_KINDS = ['transactional', 'report', 'order', 'alert', 'test'] as const;
export type MailLogKind = (typeof VALID_MAIL_KINDS)[number];
export const MAIL_ADMIN_ROLE_IDS = [0, 1, 5, 8] as const;

export function normalizeMailKind(rawKind: unknown, isTest = false): MailLogKind {
  if (isTest) return 'test';
  const cleaned = String(rawKind || '')
    .trim()
    .toLowerCase();
  if ((VALID_MAIL_KINDS as readonly string[]).includes(cleaned)) {
    return cleaned as MailLogKind;
  }
  return 'report';
}

export interface MailLogInsertInput {
  app_code: string;
  account_id?: string | null;
  provider?: string | null;
  sender_email?: string | null;
  recipient_masked: string;
  recipient_count?: number;
  subject: string;
  kind?: unknown;
  status: 'sent' | 'failed' | 'not_configured';
  message_id?: string | null;
  error_message?: string | null;
  user_id?: string | null;
}

export function buildMailLogInsertPayload(entry: MailLogInsertInput) {
  const countNum = Number(entry.recipient_count || 1);
  const safeCount = Number.isFinite(countNum)
    ? Math.min(MAX_RECIPIENTS_PER_CALL, Math.max(1, Math.trunc(countNum)))
    : 1;
  return {
    app_code: normalizeAppCode(entry.app_code),
    account_id: entry.account_id || null,
    provider: entry.provider || null,
    sender_email: entry.sender_email || null,
    recipient_masked: entry.recipient_masked,
    recipient_count: safeCount,
    subject: String(entry.subject || '').slice(0, MAX_SUBJECT_LENGTH),
    kind: normalizeMailKind(entry.kind),
    status: entry.status,
    message_id: entry.message_id || null,
    error_message: entry.error_message ? String(entry.error_message).slice(0, 500) : null,
    user_id: entry.user_id || null,
  };
}

async function logMailAttempt(
  supabaseAdmin: any,
  entry: MailLogInsertInput,
  secretToRedact?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const payload = buildMailLogInsertPayload(entry);
  try {
    const res = await supabaseAdmin.from(TABLES.mailLog).insert([payload]);
    if (res && res.error) {
      const cleanErr = sanitizeAndTranslateMailError(
        res.error.message || res.error,
        undefined,
        entry.provider || undefined,
        secretToRedact
      );
      console.error('[send-report-email] Erreur insertion core_mail_log:', cleanErr);
      return { ok: false, error: cleanErr };
    }
    return { ok: true };
  } catch (err: any) {
    const cleanErr = sanitizeAndTranslateMailError(
      err?.message || err,
      undefined,
      entry.provider || undefined,
      secretToRedact
    );
    console.error('[send-report-email] Exception insertion core_mail_log:', cleanErr);
    return { ok: false, error: cleanErr };
  }
}

export async function isRateLimitedForUser(
  supabaseAdmin: any,
  userId: string,
  maxPerHour: number
): Promise<boolean> {
  if (!userId || maxPerHour <= 0) return false;
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await supabaseAdmin
      .from(TABLES.mailLog)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', oneHourAgo);
    if (error) {
      console.error(
        '[send-report-email] Erreur vérification limite horaire core_mail_log:',
        sanitizeAndTranslateMailError(error.message || error)
      );
      return false;
    }
    return typeof count === 'number' && count >= maxPerHour;
  } catch (err: any) {
    console.error(
      '[send-report-email] Exception vérification limite horaire core_mail_log:',
      sanitizeAndTranslateMailError(err?.message || err)
    );
    return false;
  }
}

export function createSendReportEmailHandler(deps: SendReportEmailDeps = {}) {
  const authFn = deps.authenticate || authenticateCaller;
  const fetchFn = deps.fetchFn || fetch;
  const smtpTransport = deps.smtpTransport;
  const maxPerHour = deps.maxPerHour ?? MAX_EMAILS_PER_USER_PER_HOUR;

  return async function handleRequest(req: Request): Promise<Response> {
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;

    try {
      const authRes = await authFn(req);
      if (!authRes.ok) return authRes.response;

      const {
        supabaseAdmin,
        callerProfile,
        callerPerms,
        isSuperAdmin,
        hasUniversal,
      } = authRes.ctx;

      const body = await req.json().catch(() => ({}));
      const appCode = normalizeAppCode(body?.app_code);

      // Action de sonde / statut : permet au Diagnostic, à l'écran E-mails et à « À propos » de vérifier la fonction sans exposer de secret
      if (body?.action === 'status' || body?.action === 'ping') {
        const mailConfig = await resolveServerMailConfig(supabaseAdmin, appCode);
        return jsonResponse(
          {
            success: true,
            function: CLIENT_EDGE_FUNCTIONS.sendReportEmail,
            app_code: appCode,
            configured: Boolean(mailConfig.configured),
            provider: mailConfig.provider || null,
            preset: mailConfig.preset || null,
            account_name: mailConfig.account_name || null,
            from_name: mailConfig.from_name || null,
            from_email: mailConfig.from_email || null,
            legacy: Boolean(mailConfig.legacy),
            status: mailConfig.configured ? 'configuré' : 'non configuré',
            message: mailConfig.configured
              ? 'Service e-mail configuré.'
              : 'non configuré',
          },
          200
        );
      }

      const isTestRequest = Boolean(body?.test);
      const callerRoleId = Number(callerProfile.role_id);
      const isAdminCaller =
        isSuperAdmin ||
        hasUniversal ||
        (MAIL_ADMIN_ROLE_IDS as readonly number[]).includes(callerRoleId) ||
        callerPerms.includes('perm_config_email') ||
        callerPerms.includes('perm_config_db');

      const hasPermission =
        isAdminCaller ||
        callerPerms.includes('perm_report_view') ||
        callerPerms.includes('perm_email_manual_send');

      if (!hasPermission || (isTestRequest && !isAdminCaller)) {
        return jsonResponse(
          {
            success: false,
            error: isTestRequest
              ? "Permission refusée : seul un administrateur (rôles 0, 1, 5, 8 ou perm_config_email / perm_config_db) peut envoyer un e-mail de test."
              : 'Permission refusée : Droits insuffisants (rôles 0, 1, 5, 8, perm_config_email, perm_config_db, perm_report_view ou perm_email_manual_send requis).',
          },
          403
        );
      }

      // Validation des destinataires
      const rawTo = body?.to || (isTestRequest && callerProfile.email ? callerProfile.email : '');
      const rcptValidation = parseAndValidateRecipients(rawTo);
      if (!rcptValidation.ok) {
        return jsonResponse(
          {
            success: false,
            configured: true,
            error: rcptValidation.error,
          },
          400
        );
      }
      const recipients = rcptValidation.recipients;
      const recipientMasked = maskEmailRecipientList(recipients);
      const recipientCount = recipients.length;

      // Validation du sujet et du contenu HTML (avec valeurs par défaut propres en mode test)
      const rawSubject =
        typeof body?.subject === 'string' && body.subject.trim()
          ? body.subject.trim()
          : isTestRequest
          ? `[TOT Suite — ${appCode.toUpperCase()}] E-mail de test de configuration`
          : '';

      const rawHtml =
        typeof body?.htmlContent === 'string' && body.htmlContent.trim()
          ? body.htmlContent
          : isTestRequest
          ? `<div style="font-family:sans-serif;padding:20px;border:1px solid #e2e8f0;border-radius:12px;">
              <h2 style="margin-top:0;color:#0f172a;">Test d'envoi d'e-mail réussi (${appCode.toUpperCase()})</h2>
              <p>Cet e-mail confirme que le compte d'envoi et l'expéditeur de l'application <strong>${appCode}</strong> sont correctement configurés dans votre base Supabase.</p>
            </div>`
          : '';

      if (!rawSubject || !rawHtml) {
        return jsonResponse(
          {
            success: false,
            configured: true,
            error: 'Champs obligatoires manquants : "to", "subject" et "htmlContent" sont requis.',
          },
          400
        );
      }

      if (rawSubject.length > MAX_SUBJECT_LENGTH) {
        return jsonResponse(
          {
            success: false,
            configured: true,
            error: `Le sujet ne peut pas dépasser ${MAX_SUBJECT_LENGTH} caractères.`,
          },
          400
        );
      }

      const attachments: MailAttachmentInput[] = [];
      let totalPayloadBytes = new TextEncoder().encode(rawHtml).length;
      if (Array.isArray(body?.attachments)) {
        for (const att of body.attachments) {
          if (att && typeof att.filename === 'string' && typeof att.contentBase64 === 'string') {
            totalPayloadBytes += att.contentBase64.length;
            attachments.push({
              filename: att.filename.trim(),
              contentBase64: att.contentBase64.trim(),
              contentType: typeof att.contentType === 'string' ? att.contentType.trim() : undefined,
            });
          }
        }
      }

      if (totalPayloadBytes > MAX_EMAIL_PAYLOAD_BYTES) {
        return jsonResponse(
          {
            success: false,
            configured: true,
            error: 'Taille maximale du message ou des pièces jointes dépassée (maximum 5 Mo).',
          },
          400
        );
      }

      const kind = normalizeMailKind(body?.kind, isTestRequest);

      // Vérification de la limite de débit (rate-limit) par utilisateur
      const rateLimited = await isRateLimitedForUser(
        supabaseAdmin,
        String(callerProfile.id),
        maxPerHour
      );
      if (rateLimited) {
        await logMailAttempt(supabaseAdmin, {
          app_code: appCode,
          recipient_masked: recipientMasked,
          recipient_count: recipientCount,
          subject: rawSubject,
          kind,
          status: 'failed',
          error_message: `Limite d'envoi atteinte (${maxPerHour} e-mails / heure maximum par utilisateur).`,
          user_id: String(callerProfile.id),
        });
        return jsonResponse(
          {
            success: false,
            configured: true,
            error: `Limite de débit atteinte : maximum ${maxPerHour} envois par heure et par utilisateur.`,
          },
          429
        );
      }

      // Lecture de la configuration serveur via get_mail_config(app_code)
      // IMPORTANT SÉCURITÉ : sender_name et sender_email du body client sont strictement ignorés.
      const mailConfig = await resolveServerMailConfig(supabaseAdmin, appCode);

      if (mailConfig.config_error) {
        await logMailAttempt(supabaseAdmin, {
          app_code: appCode,
          recipient_masked: recipientMasked,
          recipient_count: recipientCount,
          subject: rawSubject,
          kind,
          status: 'failed',
          error_message: mailConfig.config_error,
          user_id: String(callerProfile.id),
        });

        return jsonResponse(
          {
            success: false,
            configured: false,
            error: mailConfig.config_error,
          },
          500
        );
      }

      if (!mailConfig.configured || !mailConfig.secret) {
        await logMailAttempt(supabaseAdmin, {
          app_code: appCode,
          account_id: mailConfig.account_id || null,
          provider: mailConfig.provider || null,
          sender_email: mailConfig.from_email || null,
          recipient_masked: recipientMasked,
          recipient_count: recipientCount,
          subject: rawSubject,
          kind,
          status: 'not_configured',
          error_message:
            mailConfig.reason === 'missing_secret'
              ? 'Aucun secret enregistré dans Vault pour le compte actif.'
              : 'Aucun compte d’envoi actif configuré.',
          user_id: String(callerProfile.id),
        });

        return jsonResponse(
          {
            success: false,
            configured: false,
            status: 'non configuré',
            error:
              mailConfig.reason === 'missing_secret'
                ? "non configuré : Le compte d'envoi actif n'a pas encore de clé API ou mot de passe enregistré dans Supabase Vault."
                : "non configuré : Aucun compte d'envoi d'e-mail actif n'est configuré (Paramètres > E-mails).",
          },
          200
        );
      }

      const fromName = String(mailConfig.from_name || 'TOT Stock').trim();
      const fromEmail = String(mailConfig.from_email || 'no-reply@tot-stock.pro').trim();

      const dispatchResult = await sendMailWithProvider(
        mailConfig,
        {
          fromName,
          fromEmail,
          replyTo: mailConfig.reply_to || null,
          to: recipients,
          subject: rawSubject,
          htmlContent: rawHtml,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
        fetchFn,
        smtpTransport
      );

      if (!dispatchResult.ok) {
        const cleanError = sanitizeAndTranslateMailError(
          dispatchResult.error || 'Échec d’envoi',
          dispatchResult.statusCode,
          dispatchResult.provider,
          mailConfig.secret
        );

        await logMailAttempt(
          supabaseAdmin,
          {
            app_code: appCode,
            account_id: mailConfig.account_id || null,
            provider: dispatchResult.provider,
            sender_email: fromEmail,
            recipient_masked: recipientMasked,
            recipient_count: recipientCount,
            subject: rawSubject,
            kind,
            status: 'failed',
            error_message: cleanError,
            user_id: String(callerProfile.id),
          },
          mailConfig.secret
        );

        return jsonResponse(
          {
            success: false,
            configured: true,
            provider: dispatchResult.provider,
            from_email: fromEmail,
            from_name: fromName,
            error: cleanError,
          },
          dispatchResult.statusCode && dispatchResult.statusCode >= 400
            ? dispatchResult.statusCode
            : 502
        );
      }

      await logMailAttempt(
        supabaseAdmin,
        {
          app_code: appCode,
          account_id: mailConfig.account_id || null,
          provider: dispatchResult.provider,
          sender_email: fromEmail,
          recipient_masked: recipientMasked,
          recipient_count: recipientCount,
          subject: rawSubject,
          kind,
          status: 'sent',
          message_id: dispatchResult.messageId || null,
          error_message: null,
          user_id: String(callerProfile.id),
        },
        mailConfig.secret
      );

      return jsonResponse(
        {
          success: true,
          configured: true,
          status: 'envoyé',
          app_code: appCode,
          provider: dispatchResult.provider,
          from_name: fromName,
          from_email: fromEmail,
          message: isTestRequest
            ? `E-mail de test expédié avec succès via ${dispatchResult.provider.toUpperCase()} (${fromName} <${fromEmail}>) à ${recipients.join(', ')}.`
            : `Rapport expédié avec succès à ${recipients.join(', ')}.`,
          messageId: dispatchResult.messageId,
        },
        200
      );
    } catch (err: any) {
      return jsonResponse(
        {
          success: false,
          error: sanitizeAndTranslateMailError(err?.message || 'Erreur inattendue serveur'),
        },
        500
      );
    }
  };
}

export const handleSendReportEmailRequest = createSendReportEmailHandler();
