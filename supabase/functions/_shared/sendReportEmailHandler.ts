import { handleCorsPreflight, jsonResponse } from "./cors.ts";
import { authenticateCaller } from "./auth.ts";
import { readEmailSecretConfig } from "./config.ts";

export async function handleSendReportEmailRequest(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const authRes = await authenticateCaller(req);
    if (!authRes.ok) return authRes.response;

    const {
      supabaseAdmin,
      callerPerms,
      isSuperAdmin,
      hasUniversal,
    } = authRes.ctx;

    const hasPermission =
      isSuperAdmin ||
      hasUniversal ||
      callerPerms.includes('perm_report_view') ||
      callerPerms.includes('perm_config_email') ||
      callerPerms.includes('perm_email_manual_send');

    if (!hasPermission) {
      return jsonResponse(
        {
          success: false,
          error: 'Permission refusée : Droits insuffisants (perm_report_view, perm_config_email ou perm_email_manual_send requis).',
        },
        403
      );
    }

    const body = await req.json().catch(() => ({}));
    const emailSecret = await readEmailSecretConfig(supabaseAdmin);

    // Action de sonde / statut : permet à l'application de savoir si l'e-mail est configuré (et de masquer la fonctionnalité sinon)
    if (body?.action === 'status' || body?.action === 'ping') {
      return jsonResponse(
        {
          success: true,
          configured: emailSecret.configured,
          status: emailSecret.configured ? 'configuré' : 'non configuré',
          message: emailSecret.configured
            ? 'Service e-mail configuré.'
            : 'non configuré',
        },
        200
      );
    }

    // send-report-email est facultative : si aucun secret d'e-mail n'est configuré, elle répond proprement (« non configuré »)
    if (!emailSecret.configured || !emailSecret.apiKey) {
      return jsonResponse(
        {
          success: false,
          configured: false,
          status: 'non configuré',
          error: 'non configuré : Aucun secret d\'envoi d\'e-mail n\'est défini dans Supabase Vault (ou BREVO_API_KEY).',
        },
        200
      );
    }

    const {
      to,
      subject,
      htmlContent,
      sender_name,
      sender_email,
    } = body || {};

    if (!to || !subject || !htmlContent) {
      return jsonResponse(
        {
          success: false,
          configured: true,
          error: 'Champs obligatoires manquants : "to", "subject" et "htmlContent" sont requis.',
        },
        400
      );
    }

    const cleanSenderName = String(sender_name || emailSecret.senderName || 'TOT Stock Pro').trim();
    const cleanSenderEmail = String(sender_email || emailSecret.senderEmail || 'no-reply@tot-stock.pro').trim();

    const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': emailSecret.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: {
          name: cleanSenderName,
          email: cleanSenderEmail,
        },
        to: [{ email: String(to).trim() }],
        subject: String(subject).trim(),
        htmlContent: String(htmlContent),
      }),
    });

    const brevoData = await brevoResponse.json().catch(() => ({}));

    if (!brevoResponse.ok) {
      return jsonResponse(
        {
          success: false,
          configured: true,
          error: (brevoData as any)?.message || `Échec d'envoi Brevo (code HTTP ${brevoResponse.status})`,
        },
        brevoResponse.status
      );
    }

    return jsonResponse(
      {
        success: true,
        configured: true,
        status: 'envoyé',
        message: `Rapport expédié avec succès à ${to}.`,
        messageId: (brevoData as any)?.messageId,
      },
      200
    );
  } catch (err: any) {
    return jsonResponse({ success: false, error: err?.message || 'Erreur inattendue serveur' }, 500);
  }
}
