import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflight, jsonResponse } from "./cors.ts";
import { getSupabaseEnv, readEmailSecretConfig, TABLES } from "./config.ts";
import {
  FetchLike,
  ResolvedMailConfig,
  SmtpTransportFn,
  maskEmailRecipientList,
  sanitizeAndTranslateMailError,
  sendMailWithProvider,
} from "./mailProviders.ts";

export const GENERIC_PASSWORD_RESET_MESSAGE =
  "Si ce compte existe, un code a été envoyé.";

export const PASSWORD_RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const PASSWORD_RESET_RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const PASSWORD_RESET_MAX_REQUESTS_PER_WINDOW = 3;
export const PASSWORD_RESET_MAX_ATTEMPTS = 5;

const EMAIL_SIMPLE_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PasswordResetHandlerDeps {
  getEnv?: (key: string) => string | undefined;
  createAdminClient?: (supabaseUrl: string, serviceRoleKey: string) => any;
  fetchImpl?: FetchLike;
  smtpTransport?: SmtpTransportFn;
  generateSixDigitCode?: () => string;
  now?: () => Date;
}

export function normalizeResetEmail(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase();
}

export function generateSecureSixDigitCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const n = 100000 + (buf[0] % 900000);
  return String(n);
}

export async function hashPasswordResetCode(
  code: string,
  email: string
): Promise<string> {
  const normalizedCode = String(code || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const data = new TextEncoder().encode(`${normalizedCode}:${normalizedEmail}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function escapeHtml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildPasswordResetEmailContent(
  code: string,
  userName?: string | null
): { subject: string; textContent: string; htmlContent: string } {
  const greeting = userName ? `Bonjour ${userName},` : "Bonjour,";
  const subject = "TOT Stock — Code de réinitialisation de votre mot de passe";
  const textContent = [
    greeting,
    "",
    `Votre code de réinitialisation TOT Stock est : ${code}`,
    "",
    "Ce code à 6 chiffres est valable pendant 15 minutes.",
    "Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail en toute sécurité.",
  ].join("\n");

  const htmlContent = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #0f172a;">
  <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #f97316; margin-bottom: 8px;">TOT Stock</div>
  <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 800; color: #0f172a;">Réinitialisation de votre mot de passe</h2>
  <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #334155;">${escapeHtml(greeting)}</p>
  <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #334155;">Utilisez le code à usage unique ci-dessous dans l'application TOT Stock (Web, Mobile ou Desktop) pour définir votre nouveau mot de passe :</p>
  <div style="margin: 24px 0; padding: 18px; border-radius: 12px; background-color: #f8fafc; border: 2px dashed #cbd5e1; text-align: center;">
    <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 32px; font-weight: 900; letter-spacing: 0.25em; color: #0f172a;">${escapeHtml(code)}</span>
  </div>
  <p style="margin: 0 0 12px 0; font-size: 13px; color: #64748b;">⏳ Ce code est valable pendant <strong>15 minutes</strong>.</p>
  <p style="margin: 0; font-size: 12px; color: #94a3b8;">Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail : votre mot de passe actuel reste inchangé.</p>
</div>`;

  return { subject, textContent, htmlContent };
}

function isMissingPasswordResetsTableError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || "");
  const msg = String(err.message || err.details || err || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /core_password_resets.*does not exist|relation .*core_password_resets.* does not exist|Could not find the table .*core_password_resets/i.test(
      msg
    )
  );
}

async function resolvePasswordResetMailConfig(
  supabaseAdmin: any
): Promise<{ ok: true; config: ResolvedMailConfig } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabaseAdmin.rpc("get_mail_config", {
      p_app_code: "stk",
    });

    if (error) {
      const rawMsg = String(error.message || error.details || error || "").trim();
      const isMissingRpc =
        error.code === "42883" ||
        error.code === "PGRST202" ||
        /function .*get_mail_config.* does not exist|Could not find the function/i.test(rawMsg);

      if (!isMissingRpc) {
        return {
          ok: false,
          error:
            "Envoi d'e-mail non configuré — demandez à votre administrateur de réinitialiser votre mot de passe ou de configurer Paramètres > E-mail",
        };
      }
    } else if (data && typeof data === "object") {
      const rawObj = data as Record<string, any>;
      if (
        rawObj.error === "NO_MAIL_ACCOUNT" ||
        rawObj.error === "NO_SECRET" ||
        rawObj.reason === "missing_secret" ||
        rawObj.reason === "no_active_account"
      ) {
        return {
          ok: false,
          error:
            "Envoi d'e-mail non configuré — demandez à votre administrateur de réinitialiser votre mot de passe ou de configurer Paramètres > E-mail",
        };
      }

      const secretVal = String(rawObj.secret || "").trim();
      const providerVal = String(rawObj.provider || "").trim();
      if (secretVal && providerVal) {
        return {
          ok: true,
          config: {
            configured: true,
            account_id: rawObj.account_id || null,
            account_name: rawObj.account_name || null,
            provider: rawObj.provider,
            preset: rawObj.preset || null,
            smtp_host: rawObj.smtp_host || rawObj.host || null,
            smtp_port: rawObj.smtp_port || rawObj.port || null,
            smtp_encryption: rawObj.smtp_encryption || rawObj.encryption || null,
            smtp_username: rawObj.smtp_username || rawObj.username || null,
            host: rawObj.host || rawObj.smtp_host || null,
            port: rawObj.port || rawObj.smtp_port || null,
            encryption: rawObj.encryption || rawObj.smtp_encryption || null,
            username: rawObj.username || rawObj.smtp_username || null,
            secret: secretVal,
            extra: rawObj.extra || {},
            app_code: "stk",
            from_name: rawObj.from_name || "TOT Stock",
            from_email: rawObj.from_email || "no-reply@tot-stock.pro",
            reply_to: rawObj.reply_to || null,
          },
        };
      }
    }

    const fallback = await readEmailSecretConfig(supabaseAdmin);
    if (fallback.configured && fallback.apiKey) {
      return {
        ok: true,
        config: {
          configured: true,
          legacy: true,
          provider: "brevo",
          preset: "brevo",
          secret: fallback.apiKey,
          app_code: "stk",
          from_name: fallback.senderName || "TOT Stock",
          from_email: fallback.senderEmail || "no-reply@tot-stock.pro",
          reply_to: null,
        },
      };
    }

    return {
      ok: false,
      error:
        "Envoi d'e-mail non configuré — demandez à votre administrateur de réinitialiser votre mot de passe ou de configurer Paramètres > E-mail",
    };
  } catch {
    return {
      ok: false,
      error:
        "Envoi d'e-mail non configuré — demandez à votre administrateur de réinitialiser votre mot de passe ou de configurer Paramètres > E-mail",
    };
  }
}

async function writePasswordResetAuditLog(
  supabaseAdmin: any,
  entry: {
    action: "PASSWORD_RESET_REQUESTED" | "PASSWORD_RESET_COMPLETED";
    user_id: string;
    user_name?: string | null;
    email: string;
  }
): Promise<void> {
  try {
    await supabaseAdmin.from(TABLES.auditLogs).insert({
      user_id: entry.user_id,
      user_name: entry.user_name || entry.email,
      action: entry.action,
      entity_type: "auth",
      entity_id: entry.user_id,
      details:
        entry.action === "PASSWORD_RESET_REQUESTED"
          ? `Code de réinitialisation demandé pour ${entry.email}`
          : `Mot de passe réinitialisé par code pour ${entry.email}`,
      meta: { email: entry.email },
    });
  } catch {
    // Journalisation best-effort
  }
}

async function writePasswordResetMailLog(
  supabaseAdmin: any,
  entry: {
    account_id?: string | null;
    provider?: string | null;
    sender_email?: string | null;
    recipient_email: string;
    subject: string;
    status: "sent" | "failed";
    error_message?: string | null;
    user_id?: string | null;
  }
): Promise<void> {
  try {
    await supabaseAdmin.from(TABLES.mailLog).insert({
      app_code: "stk",
      account_id: entry.account_id || null,
      provider: entry.provider || null,
      sender_email: entry.sender_email || null,
      recipient_masked: maskEmailRecipientList([entry.recipient_email]),
      recipient_count: 1,
      subject: entry.subject,
      kind: "notification",
      status: entry.status,
      error_message: entry.error_message || null,
      user_id: entry.user_id || null,
    });
  } catch {
    // Journalisation best-effort
  }
}

export function createPasswordResetHandler(
  deps: PasswordResetHandlerDeps = {}
): (req: Request) => Promise<Response> {
  const getEnv =
    deps.getEnv ??
    ((key: string) => {
      try {
        return (globalThis as any).Deno?.env?.get(key);
      } catch {
        return undefined;
      }
    });

  const createAdmin =
    deps.createAdminClient ??
    ((supabaseUrl: string, serviceRoleKey: string) =>
      createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }));

  const generateCode = deps.generateSixDigitCode ?? generateSecureSixDigitCode;
  const nowFn = deps.now ?? (() => new Date());

  return async function handlePasswordResetRequest(req: Request): Promise<Response> {
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;

    try {
      const body = await req.json().catch(() => ({}));
      const action = String(body?.action || "").trim();

      if (action === "ping") {
        return jsonResponse({ success: true, status: "ok" }, 200);
      }

      const envVars = getSupabaseEnv();
      const supabaseUrl = getEnv("SUPABASE_URL") || envVars.supabaseUrl;
      const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY") || envVars.serviceRoleKey;

      if (!supabaseUrl || !serviceRoleKey) {
        return jsonResponse(
          {
            success: false,
            error:
              "Configuration serveur Supabase incomplète (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
          },
          500
        );
      }

      const supabaseAdmin = createAdmin(supabaseUrl, serviceRoleKey);

      if (action === "request") {
        const normalizedEmail = normalizeResetEmail(body?.email);
        if (
          !normalizedEmail ||
          normalizedEmail.length > 254 ||
          !EMAIL_SIMPLE_REGEX.test(normalizedEmail)
        ) {
          return jsonResponse(
            { success: true, message: GENERIC_PASSWORD_RESET_MESSAGE },
            200
          );
        }

        // Purge opportuniste des codes expirés + détection table core_password_resets absente
        const purgeRes = await supabaseAdmin.rpc("purge_expired_password_resets");
        if (purgeRes?.error && isMissingPasswordResetsTableError(purgeRes.error)) {
          return jsonResponse(
            {
              success: false,
              error:
                "Table core_password_resets absente — exécutez install_v55.sql (ou 18_password_reset.sql)",
            },
            500
          );
        }

        const now = nowFn();
        const sinceIso = new Date(now.getTime() - PASSWORD_RESET_RATE_WINDOW_MS).toISOString();

        // Limitation : max 3 demandes par e-mail sur 15 minutes
        const { count: recentCount, error: countErr } = await supabaseAdmin
          .from(TABLES.passwordResets)
          .select("id", { count: "exact", head: true })
          .eq("email", normalizedEmail)
          .gte("created_at", sinceIso);

        if (countErr) {
          if (isMissingPasswordResetsTableError(countErr)) {
            return jsonResponse(
              {
                success: false,
                error:
                  "Table core_password_resets absente — exécutez install_v55.sql (ou 18_password_reset.sql)",
              },
              500
            );
          }
          return jsonResponse(
            { success: true, message: GENERIC_PASSWORD_RESET_MESSAGE },
            200
          );
        }

        if ((recentCount ?? 0) >= PASSWORD_RESET_MAX_REQUESTS_PER_WINDOW) {
          return jsonResponse(
            { success: true, message: GENERIC_PASSWORD_RESET_MESSAGE },
            200
          );
        }

        // Recherche du compte actif dans core_users
        const { data: matchedUsers, error: userErr } = await supabaseAdmin
          .from(TABLES.users)
          .select("id, name, email, is_blocked, auth_user_id")
          .ilike("email", normalizedEmail)
          .limit(5);

        if (userErr || !Array.isArray(matchedUsers) || matchedUsers.length === 0) {
          return jsonResponse(
            { success: true, message: GENERIC_PASSWORD_RESET_MESSAGE },
            200
          );
        }

        const activeUser = matchedUsers.find(
          (u: any) =>
            String(u.email || "").trim().toLowerCase() === normalizedEmail &&
            !u.is_blocked &&
            u.auth_user_id
        );

        if (!activeUser) {
          return jsonResponse(
            { success: true, message: GENERIC_PASSWORD_RESET_MESSAGE },
            200
          );
        }

        // Résoudre la configuration d'envoi d'e-mail (get_mail_config('stk'))
        const mailCfgResult = await resolvePasswordResetMailConfig(supabaseAdmin);
        if (!mailCfgResult.ok) {
          return jsonResponse(
            {
              success: false,
              error: mailCfgResult.error,
            },
            500
          );
        }

        const mailConfig = mailCfgResult.config;

        // Invalider les codes précédents non utilisés pour cet e-mail
        await supabaseAdmin
          .from(TABLES.passwordResets)
          .update({ used_at: now.toISOString() })
          .eq("email", normalizedEmail)
          .is("used_at", null);

        // Générer le code à 6 chiffres et stocker uniquement son hash SHA-256
        const sixDigitCode = generateCode();
        const codeHash = await hashPasswordResetCode(sixDigitCode, normalizedEmail);
        const expiresAtIso = new Date(
          now.getTime() + PASSWORD_RESET_CODE_TTL_MS
        ).toISOString();

        const { error: insertErr } = await supabaseAdmin
          .from(TABLES.passwordResets)
          .insert({
            user_id: String(activeUser.id),
            email: normalizedEmail,
            code_hash: codeHash,
            expires_at: expiresAtIso,
            attempts: 0,
          });

        if (insertErr) {
          if (isMissingPasswordResetsTableError(insertErr)) {
            return jsonResponse(
              {
                success: false,
                error:
                  "Table core_password_resets absente — exécutez install_v55.sql (ou 18_password_reset.sql)",
              },
              500
            );
          }
          return jsonResponse(
            {
              success: false,
              error: "Impossible d'enregistrer le code de réinitialisation.",
            },
            500
          );
        }

        const { subject, htmlContent } = buildPasswordResetEmailContent(
          sixDigitCode,
          activeUser.name
        );

        const fromName = String(mailConfig.from_name || "TOT Stock").trim();
        const fromEmail = String(
          mailConfig.from_email || "no-reply@tot-stock.pro"
        ).trim();

        const dispatchRes = await sendMailWithProvider(
          mailConfig,
          {
            fromName,
            fromEmail,
            replyTo: mailConfig.reply_to || null,
            to: [normalizedEmail],
            subject,
            htmlContent,
          },
          deps.fetchImpl,
          deps.smtpTransport
        );

        if (!dispatchRes.ok) {
          const cleanErr = sanitizeAndTranslateMailError(
            dispatchRes.error || "Échec d'envoi de l'e-mail",
            dispatchRes.statusCode,
            dispatchRes.provider,
            mailConfig.secret
          );

          await writePasswordResetMailLog(supabaseAdmin, {
            account_id: mailConfig.account_id || null,
            provider: dispatchRes.provider,
            sender_email: fromEmail,
            recipient_email: normalizedEmail,
            subject,
            status: "failed",
            error_message: cleanErr,
            user_id: String(activeUser.id),
          });

          return jsonResponse(
            {
              success: false,
              error: cleanErr,
            },
            502
          );
        }

        await writePasswordResetMailLog(supabaseAdmin, {
          account_id: mailConfig.account_id || null,
          provider: dispatchRes.provider,
          sender_email: fromEmail,
          recipient_email: normalizedEmail,
          subject,
          status: "sent",
          user_id: String(activeUser.id),
        });

        await writePasswordResetAuditLog(supabaseAdmin, {
          action: "PASSWORD_RESET_REQUESTED",
          user_id: String(activeUser.id),
          user_name: activeUser.name,
          email: normalizedEmail,
        });

        return jsonResponse(
          { success: true, message: GENERIC_PASSWORD_RESET_MESSAGE },
          200
        );
      }

      if (action === "confirm") {
        const normalizedEmail = normalizeResetEmail(body?.email);
        const cleanCode = String(body?.code || "").trim();
        const newPassword =
          typeof body?.newPassword === "string" ? body.newPassword : "";

        if (newPassword.length < 6 || newPassword.length > 72) {
          return jsonResponse(
            {
              success: false,
              error: "Le mot de passe doit contenir entre 6 et 72 caractères.",
            },
            400
          );
        }

        if (
          !normalizedEmail ||
          !EMAIL_SIMPLE_REGEX.test(normalizedEmail) ||
          !/^\d{6}$/.test(cleanCode)
        ) {
          return jsonResponse(
            { success: false, error: "Code invalide ou expiré" },
            400
          );
        }

        const now = nowFn();
        const nowIso = now.toISOString();

        const { data: activeRows, error: fetchErr } = await supabaseAdmin
          .from(TABLES.passwordResets)
          .select("id, user_id, email, code_hash, expires_at, attempts, used_at, created_at")
          .eq("email", normalizedEmail)
          .is("used_at", null)
          .gt("expires_at", nowIso)
          .order("created_at", { ascending: false })
          .limit(1);

        if (fetchErr) {
          if (isMissingPasswordResetsTableError(fetchErr)) {
            return jsonResponse(
              {
                success: false,
                error:
                  "Table core_password_resets absente — exécutez install_v55.sql (ou 18_password_reset.sql)",
              },
              500
            );
          }
          return jsonResponse(
            { success: false, error: "Code invalide ou expiré" },
            400
          );
        }

        const resetRow =
          Array.isArray(activeRows) && activeRows.length > 0
            ? activeRows[0]
            : null;

        if (!resetRow || Number(resetRow.attempts || 0) >= PASSWORD_RESET_MAX_ATTEMPTS) {
          return jsonResponse(
            { success: false, error: "Code invalide ou expiré" },
            400
          );
        }

        const expectedHash = await hashPasswordResetCode(
          cleanCode,
          normalizedEmail
        );
        const matches = timingSafeEqualHex(
          expectedHash,
          String(resetRow.code_hash || "")
        );

        if (!matches) {
          const nextAttempts = Number(resetRow.attempts || 0) + 1;
          const patch: Record<string, unknown> = { attempts: nextAttempts };
          if (nextAttempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
            patch.used_at = nowIso;
          }
          await supabaseAdmin
            .from(TABLES.passwordResets)
            .update(patch)
            .eq("id", resetRow.id);

          return jsonResponse(
            { success: false, error: "Code invalide ou expiré" },
            400
          );
        }

        // Vérifier le profil utilisateur lié
        const { data: matchedUsers } = await supabaseAdmin
          .from(TABLES.users)
          .select("id, name, email, is_blocked, auth_user_id")
          .ilike("email", normalizedEmail)
          .limit(5);

        const targetUser = Array.isArray(matchedUsers)
          ? matchedUsers.find(
              (u: any) =>
                String(u.id) === String(resetRow.user_id) ||
                String(u.email || "").trim().toLowerCase() === normalizedEmail
            )
          : null;

        if (!targetUser || targetUser.is_blocked || !targetUser.auth_user_id) {
          await supabaseAdmin
            .from(TABLES.passwordResets)
            .update({ used_at: nowIso })
            .eq("id", resetRow.id);

          return jsonResponse(
            { success: false, error: "Code invalide ou expiré" },
            400
          );
        }

        // Mettre à jour le mot de passe dans auth.users via Admin API
        const { error: updateAuthErr } =
          await supabaseAdmin.auth.admin.updateUserById(
            String(targetUser.auth_user_id),
            { password: newPassword }
          );

        if (updateAuthErr) {
          return jsonResponse(
            {
              success: false,
              error:
                updateAuthErr.message ||
                "Impossible de mettre à jour le mot de passe.",
            },
            500
          );
        }

        // Révoquer les sessions actives de l'utilisateur
        try {
          if (typeof supabaseAdmin.auth.admin.signOut === "function") {
            await supabaseAdmin.auth.admin.signOut(
              String(targetUser.auth_user_id),
              "global"
            );
          }
        } catch {
          // Non bloquant si signOut global n'est pas supporté par la version GoTrue
        }

        // Marquer le code comme utilisé
        await supabaseAdmin
          .from(TABLES.passwordResets)
          .update({ used_at: nowIso })
          .eq("id", resetRow.id);

        // Remettre must_change_pin à false dans core_users
        await supabaseAdmin
          .from(TABLES.users)
          .update({ must_change_pin: false })
          .eq("id", targetUser.id);

        // Tracer PASSWORD_RESET_COMPLETED dans core_audit_logs (sans code ni mot de passe)
        await writePasswordResetAuditLog(supabaseAdmin, {
          action: "PASSWORD_RESET_COMPLETED",
          user_id: String(targetUser.id),
          user_name: targetUser.name,
          email: normalizedEmail,
        });

        return jsonResponse({ success: true }, 200);
      }

      return jsonResponse(
        { success: false, error: `Action inconnue : ${action}` },
        400
      );
    } catch (err: any) {
      return jsonResponse(
        {
          success: false,
          error: err?.message || "Erreur interne du serveur",
        },
        500
      );
    }
  };
}

export const handlePasswordResetRequest = createPasswordResetHandler();
