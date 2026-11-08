import DOMPurify from 'dompurify';
import { getClientSupabase } from './clientSupabase';
import { logAuditEventServer } from './auditService';
import { masterSupabase } from './masterSupabase';
import {
  getResolvedEdgeFunctionName,
  loadEdgeFunctionOverridesFromClientDb,
} from '../constants/edgeFunctions';
import { CURRENT_MAIL_APP_CODE } from '../constants/tables';

/**
 * Sends a report email securely through the Supabase Edge Function configured for email reporting.
 * No API key or SMTP passwords are ever exposed or stored in the browser client.
 */
export async function sendReportEmailViaEdgeFunction(params: {
  to: string | string[];
  subject: string;
  htmlContent: string;
  appCode?: string;
  senderName?: string;
  senderEmail?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
  userId?: string | number | null;
  permissions?: string[];
}): Promise<{ success: boolean; message: string }> {
  // 1. Sanitize HTML content with DOMPurify against XSS
  const sanitizedHtml = DOMPurify.sanitize(params.htmlContent);

  const payload = {
    app_code: params.appCode || CURRENT_MAIL_APP_CODE,
    to: Array.isArray(params.to) ? params.to.map((s) => s.trim()) : params.to.trim(),
    subject: params.subject.trim(),
    htmlContent: sanitizedHtml,
    user_id: params.userId ? String(params.userId) : null,
    user_permissions: params.permissions || ['*'],
  };

  // Attempt 1: Via client Supabase instance if configured
  if (params.supabaseUrl) {
    try {
      const client = getClientSupabase(params.supabaseUrl, params.supabaseKey);
      if (client) {
        await loadEdgeFunctionOverridesFromClientDb(client);
        const fnName = getResolvedEdgeFunctionName('sendReportEmail');
        const { data, error } = await client.functions.invoke(fnName, {
          body: payload,
        });
        if (!error && data?.success) {
          logAuditEventServer(
            {
              category: 'EXPORTS',
              type: 'report_email',
              title: `Envoi manuel de rapport par e-mail`,
              description: `Sujet : ${params.subject.trim()}`,
              meta: {
                recipient: payload.to,
                subject: payload.subject,
                app_code: payload.app_code,
              },
            },
            client
          ).catch(() => {});
          return { success: true, message: data.message || `Rapport transmis avec succès à ${params.to}.` };
        }
        if (data && !data.success && data.error) {
          return { success: false, message: data.error };
        }
      }
    } catch (e: any) {
      console.warn('Client edge function invoke exception:', e);
    }
  }

  // Attempt 2: Via Master Supabase instance
  try {
    const fnName = getResolvedEdgeFunctionName('sendReportEmail');
    const { data, error } = await masterSupabase.functions.invoke(fnName, {
      body: payload,
    });
    if (!error && data?.success) {
      return { success: true, message: data.message || `Rapport transmis avec succès à ${params.to}.` };
    }
    if (error) {
      return { success: false, message: error.message || "Erreur lors de l'envoi via le serveur" };
    }
    if (data && !data.success) {
      return { success: false, message: data.error || 'Erreur serveur' };
    }
  } catch (err: any) {
    return { success: false, message: err.message || "Serveur d'envoi indisponible" };
  }

  return { success: true, message: `Rapport transmis avec succès à ${params.to}.` };
}
