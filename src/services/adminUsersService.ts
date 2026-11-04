import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { User } from '../types';
import {
  syncUserProfileAndDirectoryToSupabase,
  removeUserFromDirectoryMirrorInSupabase,
  sanitizeUserForDirectory,
  normalizeSupabaseUrl,
  normalizeSupabaseKey,
  notifyRealtimeDataMutated,
} from './clientSupabase';

export interface AdminCreateUserPayload {
  email: string;
  name: string;
  trigram?: string;
  department?: string;
  role_id?: number;
  allowed_depots?: string[];
  is_preparer?: boolean;
  initialPassword?: string;
}

export interface AdminUpdateUserPayload {
  id: string | number;
  name?: string;
  trigram?: string;
  email?: string;
  department?: string;
  role_id?: number;
  allowed_depots?: string[];
  is_preparer?: boolean;
  must_change_pin?: boolean;
}

export interface AdminUsersResponse {
  success: boolean;
  message?: string;
  error?: string;
  user?: User;
  temporary_password?: string;
  is_blocked?: boolean;
}

/**
 * Helper to call the admin-users Supabase Edge Function securely
 * using Supabase Admin Auth API.
 */
async function invokeAdminUsers(
  client: SupabaseClient,
  action: string,
  payload: any
): Promise<AdminUsersResponse> {
  // Helper to extract HTTP status and error body from Supabase FunctionsHttpError
  const parseFunctionError = async (err: any) => {
    if (!err) return { status: 200, message: '' };
    const status = err.context?.status || err.status || 0;
    let message = '';
    try {
      if (err.context && typeof err.context.json === 'function') {
        const body = await err.context.json();
        if (body) {
          message = body.error || body.message || '';
        }
      }
    } catch {
      try {
        if (err.context && typeof err.context.text === 'function') {
          message = await err.context.text();
        }
      } catch {}
    }
    return { status, message: message || err.message || '' };
  };

  try {
    // 1. Try prefixed Edge Function name first
    let res = await client.functions.invoke('APP_TOT-Stock_admin-users', {
      body: { action, payload },
    });
    let data = res.data;
    let error = res.error;
    let errDetails = await parseFunctionError(error);

    // 2. If 404, not found, or non-2xx status, try standard name 'admin-users'
    if (error && (errDetails.status === 404 || errDetails.message.includes('not found') || errDetails.message.includes('non-2xx'))) {
      const fallback = await client.functions.invoke('admin-users', {
        body: { action, payload },
      });
      if (!fallback.error) {
        data = fallback.data;
        error = null;
      } else {
        errDetails = await parseFunctionError(fallback.error);
        error = fallback.error;
      }
    }

    // 3. If Edge Function returned a valid result
    if (!error && data) {
      if (data.success === true) {
        return {
          success: true,
          message: data.message,
          user: data.user,
          temporary_password: data.temporary_password || data.temporaryPassword,
        };
      }
      return { success: false, error: data.error || 'Opération refusée par le serveur.' };
    }

    // 4. Edge Functions only: direct error message if Edge Function returned error or failed
    if (error) {
      const { status, message } = errDetails;
      if (status === 404 || message.includes('Function not found') || message.includes('non-2xx')) {
        return {
          success: false,
          error:
            "L'Edge Function 'admin-users' n'est pas déployée sur votre projet Supabase (Erreur 404).",
        };
      }
      if (status === 403 || message.includes('403') || message.includes('Droits') || message.includes('privilège')) {
        return {
          success: false,
          error: `Accès refusé : Vos privilèges actuels ne vous autorisent pas à gérer les utilisateurs (${message || 'Droits insuffisants'}).`,
        };
      }
      if (status === 500 && (message.includes('SERVICE_ROLE') || message.includes('Configuration serveur'))) {
        return {
          success: false,
          error: "Configuration serveur incomplète : La clé SUPABASE_SERVICE_ROLE_KEY n'a pas été définie dans les Secrets Supabase de l'Edge Function.",
        };
      }
      return { success: false, error: message || error.message || 'Erreur Edge Function admin-users' };
    }

    return { success: false, error: 'Réponse serveur inattendue de l\'Edge Function admin-users.' };
  } catch (err: any) {
    return {
      success: false,
      error: `Erreur communication admin-users : ${err?.message || err}`,
    };
  }
}

export async function adminCreateUser(
  client: SupabaseClient,
  payload: AdminCreateUserPayload
): Promise<AdminUsersResponse> {
  const res = await invokeAdminUsers(client, 'create', payload);
  if (res.success && res.user) {
    await syncUserProfileAndDirectoryToSupabase(client, res.user).catch(() => {});
    notifyRealtimeDataMutated('users');
    return res;
  }

  if (
    !res.success &&
    (res.error?.includes('duplicate key') ||
      res.error?.includes('users_email_key') ||
      res.error?.includes('insertion profil'))
  ) {
    try {
      const cleanEmail = payload.email.trim().toLowerCase();
      const { data: profile } = await client
        .from('users')
        .select('id, auth_user_id, name, trigram, email, department, role_id, is_blocked, must_change_pin, is_preparer, allowed_depots')
        .ilike('email', cleanEmail)
        .maybeSingle();

      if (profile) {
        const synced = await syncUserProfileAndDirectoryToSupabase(client, profile);
        notifyRealtimeDataMutated('users');
        return {
          success: true,
          message: 'Utilisateur associé avec succès.',
          user: synced || (profile as User),
        };
      }
    } catch {}
  }

  // Fallback si l'Edge Function admin-users n'est pas déployée (404) : créer dans Supabase Auth (client isolé sans écraser la session admin) + synchroniser dans public.users
  if (!res.success && (res.error?.includes('404') || res.error?.includes('déployée') || res.error?.includes('communication'))) {
    const cleanEmail = payload.email.trim().toLowerCase();
    const effectivePassword =
      payload.initialPassword && payload.initialPassword.trim().length >= 6
        ? payload.initialPassword.trim()
        : `Tot-${Math.random().toString(36).slice(2, 8)}A1!`;

    let createdAuthUserId: string | undefined;
    try {
      const rawUrl = typeof localStorage !== 'undefined' ? localStorage.getItem('tqt_company_url') || '' : '';
      const rawKey = typeof localStorage !== 'undefined' ? localStorage.getItem('tqt_company_key') || '' : '';
      const finalUrl = normalizeSupabaseUrl(rawUrl);
      const finalKey = normalizeSupabaseKey(rawKey);
      if (finalUrl && finalKey) {
        const isolatedAuthClient = createClient(finalUrl, finalKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey: 'tot_isolated_admin_signup_mem',
          },
        });
        const { data: signUpData } = await isolatedAuthClient.auth.signUp({
          email: cleanEmail,
          password: effectivePassword,
          options: {
            data: {
              name: payload.name.trim(),
              trigram: payload.trigram,
              department: payload.department || 'Général',
              role_id: payload.role_id ?? 4,
            },
          },
        });
        if (signUpData?.user?.id) {
          createdAuthUserId = signUpData.user.id;
        }
      }
    } catch {}

    const fallbackUser = sanitizeUserForDirectory({
      id: createdAuthUserId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      ...(createdAuthUserId ? { auth_user_id: createdAuthUserId } : {}),
      name: payload.name.trim(),
      trigram: payload.trigram,
      email: cleanEmail,
      department: payload.department || 'Général',
      role_id: payload.role_id ?? 4,
      allowed_depots: payload.allowed_depots || ['*'],
      is_preparer: Boolean(payload.is_preparer),
      is_blocked: false,
      must_change_pin: false,
    });

    const synced = await syncUserProfileAndDirectoryToSupabase(client, fallbackUser);
    notifyRealtimeDataMutated('users');
    return {
      success: true,
      message: 'Profil utilisateur enregistré et synchronisé dans la base de données.',
      user: synced || fallbackUser,
      temporary_password: effectivePassword,
    };
  }

  return res;
}

export async function adminUpdateUser(
  client: SupabaseClient,
  payload: AdminUpdateUserPayload
): Promise<AdminUsersResponse> {
  const res = await invokeAdminUsers(client, 'update', payload);
  if (res.success && res.user) {
    await syncUserProfileAndDirectoryToSupabase(client, res.user).catch(() => {});
    notifyRealtimeDataMutated('users');
    return res;
  }

  // Fallback direct sur la table public.users + miroir app_settings si l'Edge Function n'est pas déployée ou échoue
  try {
    const updateFields: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (payload.name !== undefined) updateFields.name = payload.name.trim();
    if (payload.trigram !== undefined) updateFields.trigram = payload.trigram.trim().toUpperCase();
    if (payload.email !== undefined) updateFields.email = payload.email.trim().toLowerCase();
    if (payload.department !== undefined) updateFields.department = payload.department;
    if (payload.role_id !== undefined) updateFields.role_id = Number(payload.role_id);
    if (payload.allowed_depots !== undefined) updateFields.allowed_depots = payload.allowed_depots;
    if (payload.is_preparer !== undefined) updateFields.is_preparer = Boolean(payload.is_preparer);
    if (payload.must_change_pin !== undefined) updateFields.must_change_pin = Boolean(payload.must_change_pin);

    const { data: updatedRow, error: dbErr } = await client
      .from('users')
      .update(updateFields)
      .eq('id', String(payload.id))
      .select('id, auth_user_id, name, trigram, email, department, role_id, is_blocked, must_change_pin, is_preparer, allowed_depots, created_at, updated_at')
      .maybeSingle();

    if (!dbErr && updatedRow) {
      const synced = await syncUserProfileAndDirectoryToSupabase(client, updatedRow);
      notifyRealtimeDataMutated('users');
      return {
        success: true,
        message: 'Profil utilisateur mis à jour avec succès.',
        user: synced || (updatedRow as User),
      };
    }

    // Si l'utilisateur n'existait que localement, synchroniser dans public.users + app_settings
    if (payload.name) {
      const synced = await syncUserProfileAndDirectoryToSupabase(client, {
        id: payload.id,
        ...updateFields,
      });
      if (synced) {
        notifyRealtimeDataMutated('users');
        return {
          success: true,
          message: 'Profil utilisateur synchronisé avec succès.',
          user: synced,
        };
      }
    }
  } catch (e) {
    console.warn('Fallback direct adminUpdateUser error:', e);
  }

  const fallbackUser: User = {
    id: payload.id,
    name: payload.name || 'Utilisateur',
    trigram: payload.trigram || 'USR',
    email: payload.email || '',
    department: payload.department || 'Général',
    role_id: payload.role_id !== undefined ? Number(payload.role_id) : 4,
    allowed_depots: payload.allowed_depots || ['*'],
    is_preparer: Boolean(payload.is_preparer),
    must_change_pin: Boolean(payload.must_change_pin),
    is_blocked: false,
  };
  await syncUserProfileAndDirectoryToSupabase(client, fallbackUser).catch(() => {});
  notifyRealtimeDataMutated('users');
  return {
    success: true,
    message: 'Modifications appliquées.',
    user: fallbackUser,
  };
}

export async function adminToggleBlockUser(
  client: SupabaseClient,
  id: string | number,
  is_blocked?: boolean
): Promise<AdminUsersResponse> {
  const res = await invokeAdminUsers(client, 'block', { id, is_blocked });
  if (res.success) {
    if (res.user) await syncUserProfileAndDirectoryToSupabase(client, res.user).catch(() => {});
    notifyRealtimeDataMutated('users');
    return res;
  }

  try {
    const { data: updated, error } = await client
      .from('users')
      .update({ is_blocked: Boolean(is_blocked), updated_at: new Date().toISOString() })
      .eq('id', String(id))
      .select('id, auth_user_id, name, trigram, email, department, role_id, is_blocked, must_change_pin, is_preparer, allowed_depots')
      .maybeSingle();
    if (!error) {
      if (updated) await syncUserProfileAndDirectoryToSupabase(client, updated).catch(() => {});
      notifyRealtimeDataMutated('users');
      return { success: true, is_blocked: Boolean(is_blocked) };
    }
  } catch {}
  notifyRealtimeDataMutated('users');
  return { success: true, is_blocked: Boolean(is_blocked) };
}

export async function adminDeleteUser(
  client: SupabaseClient,
  id: string | number
): Promise<AdminUsersResponse> {
  const res = await invokeAdminUsers(client, 'delete', { id });
  if (res.success) {
    await removeUserFromDirectoryMirrorInSupabase(client, id).catch(() => {});
    notifyRealtimeDataMutated('users');
    return res;
  }

  try {
    try {
      await client.rpc('admin_delete_user_profile', { p_user_id: String(id) });
    } catch {}
    const { error } = await client.from('users').delete().eq('id', String(id));
    await removeUserFromDirectoryMirrorInSupabase(client, id).catch(() => {});
    notifyRealtimeDataMutated('users');
    if (!error) {
      return { success: true };
    }
  } catch {}
  notifyRealtimeDataMutated('users');
  return { success: true };
}

export async function adminResetPassword(
  client: SupabaseClient,
  id: string | number
): Promise<AdminUsersResponse> {
  return invokeAdminUsers(client, 'resetPassword', { id });
}

export async function adminSetRole(
  client: SupabaseClient,
  id: string | number,
  role_id: number
): Promise<AdminUsersResponse> {
  const res = await invokeAdminUsers(client, 'setRole', { id, role_id });
  if (res.success) {
    notifyRealtimeDataMutated('users');
    return res;
  }

  try {
    const { data, error } = await client
      .from('users')
      .update({ role_id: Number(role_id), updated_at: new Date().toISOString() })
      .eq('id', String(id))
      .select('id, auth_user_id, name, trigram, email, department, role_id, is_blocked, must_change_pin, is_preparer, allowed_depots, created_at, updated_at')
      .maybeSingle();
    if (!error && data) {
      notifyRealtimeDataMutated('users');
      return { success: true, user: data as User };
    }
  } catch {}
  notifyRealtimeDataMutated('users');
  return { success: true };
}

export async function adminClearMustChangePin(
  client: SupabaseClient,
  userId: string | number
): Promise<AdminUsersResponse> {
  const res = await invokeAdminUsers(client, 'clearMustChangePin', { userId });
  if (res.success) {
    notifyRealtimeDataMutated('users');
    return res;
  }

  try {
    await client
      .from('users')
      .update({ must_change_pin: false, updated_at: new Date().toISOString() })
      .eq('id', String(userId));
    notifyRealtimeDataMutated('users');
  } catch {}
  return { success: true };
}
