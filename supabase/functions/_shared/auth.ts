import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSupabaseEnv } from "./config.ts";
import { jsonResponse } from "./cors.ts";

export interface AuthenticatedCallerContext {
  supabaseUrl: string;
  serviceRoleKey: string;
  supabaseAdmin: any;
  authCaller: { id: string; email?: string };
  callerProfile: {
    id: string;
    auth_user_id: string;
    name: string;
    email?: string;
    role_id: number;
    department?: string;
    allowed_depots?: string[];
    is_blocked: boolean;
  };
  callerPerms: string[];
  isSuperAdmin: boolean;
  hasUniversal: boolean;
}

/**
 * Authentifie l'appelant à partir de l'en-tête Authorization (JWT Supabase Auth),
 * vérifie que le profil existe dans public.users et n'est pas bloqué, et charge ses permissions.
 */
export async function authenticateCaller(
  req: Request
): Promise<{ ok: true; ctx: AuthenticatedCallerContext } | { ok: false; response: Response }> {
  const { supabaseUrl, supabaseAnonKey, serviceRoleKey } = getSupabaseEnv();

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false,
      response: jsonResponse(
        {
          success: false,
          error: 'Configuration serveur Supabase incomplète (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).',
        },
        500
      ),
    };
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return {
      ok: false,
      response: jsonResponse({ success: false, error: 'Authentification requise.' }, 401),
    };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey || serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
  const authCaller = authData?.user;
  if (authErr || !authCaller) {
    return {
      ok: false,
      response: jsonResponse({ success: false, error: 'Session utilisateur invalide ou expirée.' }, 401),
    };
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const { data: callerProfile, error: profErr } = await supabaseAdmin
    .from('users')
    .select('id, auth_user_id, name, email, role_id, department, allowed_depots, is_blocked')
    .eq('auth_user_id', authCaller.id)
    .maybeSingle();

  if (profErr || !callerProfile) {
    return {
      ok: false,
      response: jsonResponse({ success: false, error: 'Profil utilisateur introuvable.' }, 403),
    };
  }

  if (callerProfile.is_blocked) {
    return {
      ok: false,
      response: jsonResponse({ success: false, error: 'Compte utilisateur verrouillé.' }, 403),
    };
  }

  const { data: callerRole } = await supabaseAdmin
    .from('roles')
    .select('id, name, permissions')
    .eq('id', callerProfile.role_id)
    .maybeSingle();

  const isSuperAdmin = Number(callerProfile.role_id) === 0;
  const callerPerms: string[] = Array.isArray(callerRole?.permissions) ? callerRole.permissions : [];
  const hasUniversal = isSuperAdmin || callerPerms.includes('*');

  return {
    ok: true,
    ctx: {
      supabaseUrl,
      serviceRoleKey,
      supabaseAdmin,
      authCaller: { id: authCaller.id, email: authCaller.email },
      callerProfile: {
        id: String(callerProfile.id),
        auth_user_id: String(callerProfile.auth_user_id),
        name: String(callerProfile.name || ''),
        email: callerProfile.email ? String(callerProfile.email) : undefined,
        role_id: Number(callerProfile.role_id),
        department: callerProfile.department ? String(callerProfile.department) : undefined,
        allowed_depots: Array.isArray(callerProfile.allowed_depots) ? callerProfile.allowed_depots : [],
        is_blocked: Boolean(callerProfile.is_blocked),
      },
      callerPerms,
      isSuperAdmin,
      hasUniversal,
    },
  };
}
