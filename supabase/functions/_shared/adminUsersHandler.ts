import { handleCorsPreflight, jsonResponse } from "./cors.ts";
import { authenticateCaller } from "./auth.ts";
import { TABLES, CLIENT_EDGE_FUNCTIONS } from "./config.ts";

function generateSecureRandomPassword(length = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join('');
}

export async function handleAdminUsersRequest(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const authRes = await authenticateCaller(req);
    if (!authRes.ok) return authRes.response;

    const {
      supabaseAdmin,
      callerProfile,
      callerPerms,
      isSuperAdmin,
      hasUniversal,
    } = authRes.ctx;

    const { data: deptRows } = await supabaseAdmin
      .from(TABLES.departments)
      .select('id, name, manager_id, deputy_manager_ids');

    const callerIdStr = String(callerProfile.id);
    const managedDeptNames: string[] = [];
    if (Array.isArray(deptRows)) {
      for (const d of deptRows) {
        const isMgr = String(d.manager_id) === callerIdStr;
        const isDeputy =
          Array.isArray(d.deputy_manager_ids) &&
          d.deputy_manager_ids.some((depId: any) => String(depId) === callerIdStr);
        if (isMgr || isDeputy) {
          managedDeptNames.push(d.name);
        }
      }
    }
    if (callerProfile.department && !managedDeptNames.includes(callerProfile.department)) {
      managedDeptNames.push(callerProfile.department);
    }

    const isDeptManager = Number(callerProfile.role_id) === 8;

    const logAudit = async (actionType: string, targetId: any, targetName: string, extra: any = {}) => {
      try {
        const auditId = `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        const isSensitiveAction =
          isDeptManager ||
          ['delete', 'reset_password', 'set_role', 'block'].includes(actionType) ||
          (actionType === 'update' && extra?.updates?.role_id !== undefined);
        const severity = isSensitiveAction ? 'WARNING' : 'INFO';
        const title = `Action utilisateur (${actionType}) : ${targetName || targetId}`;
        const description = isDeptManager
          ? `Action administrative (${actionType}) déléguée par ${callerProfile.name} (${callerProfile.department}) sur ${targetName || targetId}`
          : `Action administrative (${actionType}) exécutée par ${callerProfile.name} sur ${targetName || targetId}`;
        const detailsPayload = {
          performed_by_id: callerProfile.id,
          performed_by_name: callerProfile.name,
          caller_role: callerProfile.role_id,
          caller_department: callerProfile.department,
          target_user_id: targetId,
          target_user_name: targetName,
          is_delegated_dept_manager: isDeptManager,
          notice_it: isDeptManager
            ? `Action administrative déléguée par le Responsable de Département ${callerProfile.name} (${callerProfile.department}) sur le compte ${targetName || targetId}.`
            : null,
          ...extra,
        };
        await supabaseAdmin.from(TABLES.auditLogs).insert([{
          id: auditId,
          app: 'stock',
          timestamp: new Date().toISOString(),
          user_id: String(callerProfile.id),
          user_name: callerProfile.name,
          action: `USER_${actionType.toUpperCase()}`,
          type: 'USER_ADMIN_' + actionType.toUpperCase(),
          category: 'USERS',
          title,
          description,
          severity,
          meta: detailsPayload,
          details: detailsPayload,
          created_at: new Date().toISOString(),
        }]);
      } catch (logErr: any) {
        console.warn('Erreur insertion core_audit_logs:', logErr?.message);
      }
    };

    const body = await req.json().catch(() => ({}));
    const { action, payload } = body;

    if (action === 'ping' || action === 'status') {
      return jsonResponse({ success: true, function: CLIENT_EDGE_FUNCTIONS.adminUsers, status: 'ok' }, 200);
    }

    if (action === 'clearMustChangePin') {
      const targetUserId = payload?.userId || callerProfile.id;
      const canClear =
        String(targetUserId) === String(callerProfile.id) ||
        hasUniversal ||
        callerPerms.includes('perm_user_force_pin') ||
        callerPerms.includes('perm_manage_users');

      if (!canClear) {
        return jsonResponse({ success: false, error: 'Permission refusée pour effacer ce drapeau.' }, 403);
      }

      await supabaseAdmin
        .from(TABLES.users)
        .update({ must_change_pin: false, updated_at: new Date().toISOString() })
        .eq('id', targetUserId);

      return jsonResponse({ success: true, message: 'Drapeau de réinitialisation effacé.' }, 200);
    }

    if (action === 'create') {
      const canCreate = hasUniversal || callerPerms.includes('perm_manage_users');
      if (!canCreate) {
        return jsonResponse(
          { success: false, error: "Permission insuffisante : droit de gestion d'utilisateur requis (perm_manage_users)." },
          403
        );
      }

      const {
        email,
        name,
        trigram,
        department,
        role_id,
        allowed_depots,
        is_preparer,
        initialPassword,
      } = payload || {};

      if (!email || !name) {
        return jsonResponse(
          { success: false, error: "L'email et le nom sont requis pour créer un utilisateur." },
          400
        );
      }

      const targetRoleId = Number(role_id ?? 4);

      if (isDeptManager) {
        if (targetRoleId !== 4 && targetRoleId !== 9) {
          return jsonResponse(
            {
              success: false,
              error: 'Délégation Responsable de département : vous ne pouvez créer que des comptes Opérateur (rôle 4) ou Intérimaire (rôle 9).',
            },
            403
          );
        }
        const deptNorm = (department || '').toLowerCase().trim();
        const allowedDeptsNorm = managedDeptNames.map((n) => n.toLowerCase().trim());
        if (!deptNorm || !allowedDeptsNorm.includes(deptNorm)) {
          return jsonResponse(
            {
              success: false,
              error: `Délégation Responsable de département : vous ne pouvez créer des comptes que dans votre département (${managedDeptNames.join(', ')}).`,
            },
            403
          );
        }
        const callerDepots: string[] = Array.isArray(callerProfile.allowed_depots) ? callerProfile.allowed_depots : [];
        if (!Array.isArray(allowed_depots) || allowed_depots.length === 0 || allowed_depots.includes('*') || allowed_depots.includes('ALL')) {
          return jsonResponse(
            {
              success: false,
              error: "Délégation Responsable de département : vous ne pouvez pas attribuer l'accès universel à tous les dépôts (*). Choisissez parmi vos propres dépôts.",
            },
            403
          );
        }
        if (!callerDepots.includes('*')) {
          const unauthorized = allowed_depots.filter((dep: string) => !callerDepots.includes(dep));
          if (unauthorized.length > 0) {
            return jsonResponse(
              {
                success: false,
                error: `Dépôts non autorisés : vous ne pouvez attribuer que vos propres dépôts (${callerDepots.join(', ')}).`,
              },
              403
            );
          }
        }
      }

      if (Array.isArray(allowed_depots) && allowed_depots.includes('*') && !isSuperAdmin) {
        return jsonResponse(
          {
            success: false,
            error: "Seul un Super Administrateur (rôle 0) peut attribuer l'accès universel à tous les dépôts (*).",
          },
          403
        );
      }

      const { data: targetRoleData } = await supabaseAdmin
        .from(TABLES.roles)
        .select('id, permissions')
        .eq('id', targetRoleId)
        .maybeSingle();

      const targetRolePerms: string[] = targetRoleData?.permissions || [];
      const roleHasWildcard = targetRoleId === 0 || targetRolePerms.includes('*');

      if (roleHasWildcard && !isSuperAdmin) {
        return jsonResponse(
          {
            success: false,
            error: 'Seul un Super Administrateur (rôle 0) peut attribuer un rôle avec privilège universel (*) ou créer un Super Admin.',
          },
          403
        );
      }

      const tempPassword = initialPassword || generateSecureRandomPassword(16);

      const { data: newAuthUser, error: authCreateErr } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim().toLowerCase(),
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          name,
          trigram: trigram || name.substring(0, 3).toUpperCase(),
        },
      });

      if (authCreateErr || !newAuthUser?.user) {
        return jsonResponse(
          { success: false, error: authCreateErr?.message || 'Erreur lors de la création du compte Auth.' },
          400
        );
      }

      const { data: existingUser } = await supabaseAdmin
        .from(TABLES.users)
        .select('id, auth_user_id, name, trigram, email, department, role_id, is_blocked, must_change_pin, is_preparer, allowed_depots, created_at, updated_at')
        .ilike('email', email.trim().toLowerCase())
        .maybeSingle();

      let insertedUser = existingUser;
      let insertErr: any = null;

      if (existingUser) {
        const { data: updatedUser, error: updateErr } = await supabaseAdmin
          .from(TABLES.users)
          .update({
            auth_user_id: newAuthUser.user.id,
            name: name.trim(),
            trigram: trigram ? trigram.trim().toUpperCase() : existingUser.trigram || name.substring(0, 3).toUpperCase(),
            department: department || existingUser.department || 'Général',
            role_id: targetRoleId,
            is_blocked: false,
            must_change_pin: true,
            is_preparer: Boolean(is_preparer),
            allowed_depots:
              Array.isArray(allowed_depots) && allowed_depots.length > 0
                ? allowed_depots
                : existingUser.allowed_depots || ['*'],
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingUser.id)
          .select('id, auth_user_id, name, trigram, email, department, role_id, is_blocked, must_change_pin, is_preparer, allowed_depots, created_at, updated_at')
          .single();

        if (updateErr) {
          insertErr = updateErr;
        } else {
          insertedUser = updatedUser;
        }
      } else {
        const insertPayload: Record<string, any> = {
          id: newAuthUser.user.id,
          auth_user_id: newAuthUser.user.id,
          name: name.trim(),
          trigram: trigram ? trigram.trim().toUpperCase() : name.substring(0, 3).toUpperCase(),
          email: email.trim().toLowerCase(),
          department: department || 'Général',
          role_id: targetRoleId,
          is_blocked: false,
          must_change_pin: true,
          is_preparer: Boolean(is_preparer),
          allowed_depots: Array.isArray(allowed_depots) && allowed_depots.length > 0 ? allowed_depots : ['*'],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const res = await supabaseAdmin
          .from(TABLES.users)
          .insert([insertPayload])
          .select('id, auth_user_id, name, trigram, email, department, role_id, is_blocked, must_change_pin, is_preparer, allowed_depots, created_at, updated_at')
          .single();

        insertedUser = res.data;
        insertErr = res.error;

        if (insertErr && (insertErr.message.includes('duplicate key') || insertErr.message.includes('users_email_key'))) {
          const retryUpdate = await supabaseAdmin
            .from(TABLES.users)
            .update({
              auth_user_id: newAuthUser.user.id,
              name: name.trim(),
              trigram: trigram ? trigram.trim().toUpperCase() : name.substring(0, 3).toUpperCase(),
              department: department || 'Général',
              role_id: targetRoleId,
              is_blocked: false,
              must_change_pin: true,
              is_preparer: Boolean(is_preparer),
              allowed_depots: Array.isArray(allowed_depots) && allowed_depots.length > 0 ? allowed_depots : ['*'],
              updated_at: new Date().toISOString(),
            })
            .ilike('email', email.trim().toLowerCase())
            .select('id, auth_user_id, name, trigram, email, department, role_id, is_blocked, must_change_pin, is_preparer, allowed_depots, created_at, updated_at')
            .maybeSingle();

          if (!retryUpdate.error && retryUpdate.data) {
            insertedUser = retryUpdate.data;
            insertErr = null;
          }
        }
      }

      if (insertErr) {
        await supabaseAdmin.auth.admin.deleteUser(newAuthUser.user.id);
        return jsonResponse({ success: false, error: `Erreur insertion profil : ${insertErr.message}` }, 500);
      }

      await logAudit('create', insertedUser?.id, insertedUser?.name, {
        email: insertedUser?.email,
        role_id: targetRoleId,
        department: insertedUser?.department,
        allowed_depots: insertedUser?.allowed_depots,
      });

      return jsonResponse(
        {
          success: true,
          user: insertedUser,
          temporaryPassword: tempPassword,
          message: 'Utilisateur créé avec succès. Mot de passe temporaire généré.',
        },
        200
      );
    }

    if (action === 'update') {
      const canUpdate = hasUniversal || callerPerms.includes('perm_manage_users');
      if (!canUpdate) {
        return jsonResponse(
          { success: false, error: "Permission insuffisante : droit de gestion d'utilisateur requis (perm_manage_users)." },
          403
        );
      }

      const { userId, updates } = payload || {};
      if (!userId) {
        return jsonResponse({ success: false, error: "L'ID utilisateur est requis." }, 400);
      }

      const { data: targetUser } = await supabaseAdmin
        .from(TABLES.users)
        .select('id, auth_user_id, name, role_id, department, allowed_depots')
        .eq('id', userId)
        .maybeSingle();

      if (!targetUser) {
        return jsonResponse({ success: false, error: 'Utilisateur cible introuvable.' }, 404);
      }

      if (Number(targetUser.role_id) === 0 && !isSuperAdmin) {
        return jsonResponse(
          { success: false, error: 'Seul un Super Administrateur peut modifier un compte Super Admin.' },
          403
        );
      }

      if (isDeptManager) {
        const targetDept = (targetUser.department || '').toLowerCase().trim();
        const allowedDeptsNorm = managedDeptNames.map((n) => n.toLowerCase().trim());
        if (!allowedDeptsNorm.includes(targetDept)) {
          return jsonResponse(
            {
              success: false,
              error: 'Délégation Responsable de département : vous ne pouvez modifier que les utilisateurs de votre département.',
            },
            403
          );
        }
        if (updates?.role_id !== undefined && Number(updates.role_id) !== Number(targetUser.role_id)) {
          return jsonResponse(
            {
              success: false,
              error: "Délégation Responsable de département : vous ne pouvez pas modifier le rôle d'un utilisateur.",
            },
            403
          );
        }
        if (updates?.department !== undefined && updates.department.toLowerCase().trim() !== targetDept) {
          return jsonResponse(
            {
              success: false,
              error: "Délégation Responsable de département : vous ne pouvez pas changer le département d'un utilisateur.",
            },
            403
          );
        }
        if (Array.isArray(updates?.allowed_depots) && (updates.allowed_depots.includes('*') || updates.allowed_depots.includes('ALL'))) {
          return jsonResponse(
            {
              success: false,
              error: "Délégation Responsable de département : vous ne pouvez pas attribuer l'accès universel à tous les dépôts (*).",
            },
            403
          );
        }
      }

      if (Array.isArray(updates?.allowed_depots) && updates.allowed_depots.includes('*') && !isSuperAdmin) {
        return jsonResponse(
          {
            success: false,
            error: "Seul un Super Administrateur (rôle 0) peut attribuer l'accès universel à tous les dépôts (*).",
          },
          403
        );
      }

      if (updates?.role_id !== undefined) {
        const targetRoleId = Number(updates.role_id);
        const { data: newRoleData } = await supabaseAdmin
          .from(TABLES.roles)
          .select('id, permissions')
          .eq('id', targetRoleId)
          .maybeSingle();

        const newRolePerms: string[] = newRoleData?.permissions || [];
        if ((targetRoleId === 0 || newRolePerms.includes('*')) && !isSuperAdmin) {
          return jsonResponse(
            {
              success: false,
              error: 'Seul un Super Administrateur peut attribuer un rôle avec privilège universel (*).',
            },
            403
          );
        }
      }

      const safeUpdates: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };
      if (updates.name !== undefined) safeUpdates.name = updates.name.trim();
      if (updates.trigram !== undefined) safeUpdates.trigram = updates.trigram.trim().toUpperCase();
      if (updates.department !== undefined) safeUpdates.department = updates.department;
      if (updates.role_id !== undefined) safeUpdates.role_id = Number(updates.role_id);
      if (updates.is_preparer !== undefined) safeUpdates.is_preparer = Boolean(updates.is_preparer);
      if (updates.allowed_depots !== undefined) safeUpdates.allowed_depots = updates.allowed_depots;
      if (updates.must_change_pin !== undefined) safeUpdates.must_change_pin = Boolean(updates.must_change_pin);

      if (updates.email !== undefined && updates.email.trim()) {
        safeUpdates.email = updates.email.trim().toLowerCase();
        if (targetUser.auth_user_id) {
          await supabaseAdmin.auth.admin.updateUserById(targetUser.auth_user_id, {
            email: safeUpdates.email,
          });
        }
      }

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from(TABLES.users)
        .update(safeUpdates)
        .eq('id', userId)
        .select('id, auth_user_id, name, trigram, email, department, role_id, is_blocked, must_change_pin, is_preparer, allowed_depots, created_at, updated_at')
        .single();

      if (updateErr) {
        return jsonResponse({ success: false, error: updateErr.message }, 500);
      }

      await logAudit('update', updated?.id, updated?.name, { updates: safeUpdates });

      return jsonResponse({ success: true, user: updated, message: 'Utilisateur mis à jour avec succès.' }, 200);
    }

    if (action === 'block' || action === 'unblock') {
      const canBlock =
        hasUniversal ||
        callerPerms.includes('perm_user_block') ||
        callerPerms.includes('perm_manage_users');

      if (!canBlock) {
        return jsonResponse(
          { success: false, error: 'Permission insuffisante : droit de blocage requis (perm_user_block).' },
          403
        );
      }

      const { userId } = payload || {};
      const { data: targetUser } = await supabaseAdmin
        .from(TABLES.users)
        .select('id, auth_user_id, name, role_id, department')
        .eq('id', userId)
        .maybeSingle();

      if (!targetUser) {
        return jsonResponse({ success: false, error: 'Utilisateur cible introuvable.' }, 404);
      }

      if (Number(targetUser.role_id) === 0 && !isSuperAdmin) {
        return jsonResponse(
          { success: false, error: "Seul un Super Administrateur peut modifier le statut d'un compte Super Admin." },
          403
        );
      }

      if (isDeptManager) {
        const targetDept = (targetUser.department || '').toLowerCase().trim();
        const allowedDeptsNorm = managedDeptNames.map((n) => n.toLowerCase().trim());
        if (!allowedDeptsNorm.includes(targetDept)) {
          return jsonResponse(
            {
              success: false,
              error: 'Délégation Responsable de département : vous ne pouvez bloquer ou débloquer que les utilisateurs de votre département.',
            },
            403
          );
        }
      }

      const isBlocked = action === 'block';
      const { data: updated, error: blockErr } = await supabaseAdmin
        .from(TABLES.users)
        .update({ is_blocked: isBlocked, updated_at: new Date().toISOString() })
        .eq('id', userId)
        .select('id, auth_user_id, name, trigram, email, department, role_id, is_blocked, must_change_pin, is_preparer, allowed_depots, created_at, updated_at')
        .single();

      if (blockErr) {
        return jsonResponse({ success: false, error: blockErr.message }, 500);
      }

      if (targetUser.auth_user_id) {
        try {
          await supabaseAdmin.auth.admin.updateUserById(targetUser.auth_user_id, {
            ban_duration: isBlocked ? '876000h' : 'none',
          });
        } catch (banErr: any) {
          console.warn(`Erreur mise à jour ban_duration Auth pour ${targetUser.auth_user_id}:`, banErr?.message);
        }
      }

      await logAudit(action, updated?.id, updated?.name, { is_blocked: isBlocked });

      return jsonResponse(
        {
          success: true,
          user: updated,
          message: isBlocked
            ? 'Compte utilisateur verrouillé et désactivé dans Auth.'
            : 'Compte utilisateur déverrouillé et réactivé dans Auth.',
        },
        200
      );
    }

    if (action === 'delete') {
      if (isDeptManager) {
        return jsonResponse(
          {
            success: false,
            error: 'Délégation Responsable de département : vous ne pouvez pas supprimer de compte. Veuillez contacter un administrateur.',
          },
          403
        );
      }

      const canDelete =
        hasUniversal ||
        callerPerms.includes('perm_user_delete') ||
        callerPerms.includes('perm_manage_users');

      if (!canDelete) {
        return jsonResponse(
          { success: false, error: 'Permission insuffisante : droit de suppression requis (perm_user_delete).' },
          403
        );
      }

      const { userId } = payload || {};
      const { data: targetUser } = await supabaseAdmin
        .from(TABLES.users)
        .select('id, auth_user_id, name, role_id')
        .eq('id', userId)
        .maybeSingle();

      if (!targetUser) {
        return jsonResponse({ success: false, error: 'Utilisateur introuvable.' }, 404);
      }

      if (Number(targetUser.role_id) === 0 && !isSuperAdmin) {
        return jsonResponse(
          { success: false, error: 'Seul un Super Administrateur peut supprimer un compte Super Admin.' },
          403
        );
      }

      if (targetUser.auth_user_id) {
        await supabaseAdmin.auth.admin.deleteUser(targetUser.auth_user_id);
      }

      const { error: delErr } = await supabaseAdmin
        .from(TABLES.users)
        .delete()
        .eq('id', userId);

      if (delErr) {
        return jsonResponse({ success: false, error: delErr.message }, 500);
      }

      await logAudit('delete', targetUser.id, targetUser.name, {});

      return jsonResponse({ success: true, message: 'Compte utilisateur supprimé avec succès.' }, 200);
    }

    if (action === 'resetPassword') {
      const canReset =
        hasUniversal ||
        callerPerms.includes('perm_user_force_pin') ||
        callerPerms.includes('perm_manage_users');

      if (!canReset) {
        return jsonResponse(
          { success: false, error: 'Permission insuffisante : droit de réinitialisation requis (perm_user_force_pin).' },
          403
        );
      }

      const { userId, newPassword } = payload || {};
      const { data: targetUser } = await supabaseAdmin
        .from(TABLES.users)
        .select('id, auth_user_id, name, role_id, department')
        .eq('id', userId)
        .maybeSingle();

      if (!targetUser) {
        return jsonResponse({ success: false, error: 'Utilisateur introuvable.' }, 404);
      }

      if (Number(targetUser.role_id) === 0 && !isSuperAdmin) {
        return jsonResponse(
          { success: false, error: "Seul un Super Administrateur peut réinitialiser le mot de passe d'un Super Admin." },
          403
        );
      }

      if (isDeptManager) {
        const targetDept = (targetUser.department || '').toLowerCase().trim();
        const allowedDeptsNorm = managedDeptNames.map((n) => n.toLowerCase().trim());
        if (!allowedDeptsNorm.includes(targetDept)) {
          return jsonResponse(
            {
              success: false,
              error: 'Délégation Responsable de département : vous ne pouvez réinitialiser que les comptes de votre département.',
            },
            403
          );
        }
      }

      const tempPassword = newPassword || generateSecureRandomPassword(16);

      if (targetUser.auth_user_id) {
        const { error: resetErr } = await supabaseAdmin.auth.admin.updateUserById(targetUser.auth_user_id, {
          password: tempPassword,
        });
        if (resetErr) {
          return jsonResponse({ success: false, error: resetErr.message }, 500);
        }
      }

      await supabaseAdmin
        .from(TABLES.users)
        .update({ must_change_pin: true, updated_at: new Date().toISOString() })
        .eq('id', userId);

      await logAudit('reset_password', targetUser.id, targetUser.name, {});

      return jsonResponse(
        {
          success: true,
          temporaryPassword: tempPassword,
          message: 'Mot de passe réinitialisé. Le changement de mot de passe sera exigé à la prochaine connexion.',
        },
        200
      );
    }

    if (action === 'setRole') {
      if (isDeptManager) {
        return jsonResponse(
          {
            success: false,
            error: "Délégation Responsable de département : vous ne pouvez pas modifier le rôle d'un utilisateur.",
          },
          403
        );
      }

      const canSetRole = hasUniversal || callerPerms.includes('perm_manage_roles');
      if (!canSetRole) {
        return jsonResponse({ success: false, error: 'Permission insuffisante pour attribuer un rôle.' }, 403);
      }

      const { userId, roleId } = payload || {};
      const targetRoleId = Number(roleId);

      const { data: targetRoleData } = await supabaseAdmin
        .from(TABLES.roles)
        .select('id, permissions')
        .eq('id', targetRoleId)
        .maybeSingle();

      const targetRolePerms: string[] = targetRoleData?.permissions || [];
      if ((targetRoleId === 0 || targetRolePerms.includes('*')) && !isSuperAdmin) {
        return jsonResponse(
          {
            success: false,
            error: 'Seul un Super Administrateur peut attribuer un rôle avec privilège universel (*).',
          },
          403
        );
      }

      const { data: updated, error: setRoleErr } = await supabaseAdmin
        .from(TABLES.users)
        .update({ role_id: targetRoleId, updated_at: new Date().toISOString() })
        .eq('id', userId)
        .select('id, auth_user_id, name, trigram, email, department, role_id, is_blocked, must_change_pin, is_preparer, allowed_depots, created_at, updated_at')
        .single();

      if (setRoleErr) {
        return jsonResponse({ success: false, error: setRoleErr.message }, 500);
      }

      await logAudit('set_role', updated?.id, updated?.name, { new_role_id: targetRoleId });

      return jsonResponse({ success: true, user: updated, message: 'Rôle mis à jour.' }, 200);
    }

    return jsonResponse({ success: false, error: `Action inconnue : ${action}` }, 400);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err?.message || 'Erreur inattendue serveur' }, 500);
  }
}
