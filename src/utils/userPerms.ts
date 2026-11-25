// v5.23.0 — Helpers de permissions utilisables depuis services et composants
// sans dépendance au contexte React. S'appuient uniquement sur la liste
// `permissions` embarquée dans l'objet User (peuplée par AppContext).

import type { User } from '../types';

/** Vrai si l'utilisateur est le super admin (role 0). Seul emplacement avec
 *  un contrôle de rôle codé en dur en dehors de userHasPermission. */
export function isSuperAdmin(user?: Pick<User, 'role_id'> | null): boolean {
  return Boolean(user) && Number(user!.role_id) === 0;
}

/** Vrai si l'utilisateur a la permission (super admin ou wildcard '*' inclus). */
export function userHasPerm(
  user: (Pick<User, 'role_id'> & { permissions?: string[] | null }) | null | undefined,
  perm: string
): boolean {
  if (!user) return false;
  if (Number(user.role_id) === 0) return true; // super admin bypass
  const perms = user.permissions || [];
  if (perms.includes('*')) return true;
  return perms.includes(perm);
}

/** Vrai si l'utilisateur a les droits d'administration généraux
 *  (perm_admin_level). Les rôles 0 et 1 l'ont par défaut dans le seeding. */
export function isAdminLevel(
  user: (Pick<User, 'role_id'> & { permissions?: string[] | null }) | null | undefined
): boolean {
  return userHasPerm(user, 'perm_admin_level');
}
