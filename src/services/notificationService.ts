import {
  Department,
  Depot,
  MaterialOrder,
  Product,
  Project,
  Role,
  StockTransferRecord,
  User,
} from '../types';
import { getDismissedKeysSync } from './notificationReadService';
import { getClosedProjectContainerAlertsForUser } from './projectStatusService';

export type StockTransfer = StockTransferRecord & {
  from_depot_id?: string | number | null;
  to_depot_id?: string | number | null;
};

export type TargetedNotificationEventType =
  | 'ORDER_WAITING_APPROVAL'
  | 'ORDER_PENDING_PREP'
  | 'ORDER_ASSIGNED'
  | 'ORDER_READY'
  | 'ORDER_MODIFIED_OR_CANCELLED'
  | 'ORDER_PICKUP_DELEGATED'
  | 'ORDER_COLLECTED'
  | 'TRANSFER_EVENT';

export type NotificationEventTypeAlias =
  | TargetedNotificationEventType
  | 'ORDER_TO_PREPARE'
  | 'ORDER_READY_FOR_PICKUP'
  | 'ORDER_REJECTED'
  | 'ORDER_CANCELLED'
  | 'ORDER_MODIFIED'
  | 'TRANSFER_INCOMING'
  | 'TRANSFER_ANOMALY_OR_RETURN'
  | 'TRANSFER_OVERDUE'
  | 'STOCK_LOW_ALERT'
  | 'PROJECT_CLOSED';

export const ALL_TARGETED_NOTIFICATION_TYPES: readonly TargetedNotificationEventType[] = [
  'ORDER_WAITING_APPROVAL',
  'ORDER_PENDING_PREP',
  'ORDER_ASSIGNED',
  'ORDER_READY',
  'ORDER_MODIFIED_OR_CANCELLED',
  'ORDER_PICKUP_DELEGATED',
  'ORDER_COLLECTED',
  'TRANSFER_EVENT',
] as const;

export const ORDER_CANCELLED_REJECTED_TTL_DAYS = 7;
export const ORDER_CANCELLED_REJECTED_TTL_MS = ORDER_CANCELLED_REJECTED_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface NotificationChannelPref {
  beep: boolean;
  banner: boolean;
}

export type UserNotificationPreferencesMap = Record<
  TargetedNotificationEventType,
  NotificationChannelPref
>;

const NOTIFICATION_PREFS_STORAGE_PREFIX = 'tot_notif_type_prefs_v1';

/**
 * Construit l'identifiant stable d'une notification :
 * `notif_key = "<TYPE>:<id>:<status>"`
 * Exemples :
 * - `ORDER_READY:ord_123:READY`
 * - `ORDER_MODIFIED_OR_CANCELLED:ord_123:CANCELLED`
 * - `STOCK_LOW_ALERT:<id produit>:<LOW|OUT>`
 */
export function buildNotificationKey(
  typeOrParams:
    | NotificationEventTypeAlias
    | string
    | { type: NotificationEventTypeAlias | string; id: string | number; status: string },
  id?: string | number | null,
  status?: string | null
): string {
  if (typeof typeOrParams === 'object' && typeOrParams !== null) {
    const t = String(typeOrParams.type || '').trim();
    const i = String(typeOrParams.id ?? '').trim();
    const s = String(typeOrParams.status || '').trim();
    return `${t}:${i}:${s}`;
  }
  const cleanType = String(typeOrParams || '').trim();
  const cleanId = String(id ?? '').trim();
  const cleanStatus = String(status || '').trim();
  return `${cleanType}:${cleanId}:${cleanStatus}`;
}

/**
 * Indique si une notification doit être marquée comme lue automatiquement au clic sur sa carte.
 * - WAITING_APPROVAL, PENDING, PREPARING, READY -> false (reste tant que le statut n'a pas changé, sauf clic sur ✕)
 * - CANCELLED, REJECTED, MODIFIED, COLLECTED, TRANSFER_EVENT, STOCK_LOW_ALERT -> true
 */
export function shouldAutoDismissOnCardClick(
  typeOrStatus: NotificationEventTypeAlias | string
): boolean {
  const key = String(typeOrStatus || '').trim().toUpperCase();
  switch (key) {
    case 'WAITING_APPROVAL':
    case 'PENDING':
    case 'PREPARING':
    case 'READY':
    case 'ORDER_WAITING_APPROVAL':
    case 'ORDER_PENDING_PREP':
    case 'ORDER_TO_PREPARE':
    case 'ORDER_ASSIGNED':
    case 'ORDER_ASSIGNED_TO_ME':
    case 'ORDER_READY':
    case 'ORDER_READY_FOR_PICKUP':
    case 'ORDER_PICKUP_DELEGATED':
    case 'TRANSFER_OVERDUE':
      return false;
    case 'CANCELLED':
    case 'REJECTED':
    case 'MODIFIED':
    case 'COLLECTED':
    case 'ORDER_MODIFIED_OR_CANCELLED':
    case 'ORDER_CANCELLED':
    case 'ORDER_REJECTED':
    case 'ORDER_MODIFIED':
    case 'ORDER_COLLECTED':
    case 'TRANSFER_EVENT':
    case 'TRANSFER_INCOMING':
    case 'TRANSFER_PENDING_RECEPTION':
    case 'TRANSFER_ANOMALY_OR_RETURN':
    case 'IN_TRANSIT':
    case 'AWAITING_SENDER':
    case 'PARTIALLY_RECEIVED':
    case 'STOCK_LOW_ALERT':
    case 'LOW':
    case 'OUT':
    case 'PROJECT_CLOSED':
      return true;
    default:
      return false;
  }
}

/**
 * Garde-fou d'ancienneté : les commandes `CANCELLED` ou `REJECTED` dont `updated_at`
 * (ou `cancelled_at` / `rejected_at`) a plus de 7 jours ne sont plus proposées dans la cloche, même non lues.
 */
export function isOrderNotificationExpired(
  order: Partial<MaterialOrder> & {
    updated_at?: string | null;
    cancelled_at?: string | null;
    rejected_at?: string | null;
  },
  nowMs: number = Date.now()
): boolean {
  if (!order) return false;
  if (order.status !== 'CANCELLED' && order.status !== 'REJECTED') {
    return false;
  }
  const rawDate =
    order.cancelled_at ||
    order.rejected_at ||
    order.updated_at ||
    order.created_at;
  if (!rawDate) return false;
  const ts = new Date(rawDate).getTime();
  if (!Number.isFinite(ts)) return false;
  return nowMs - ts > ORDER_CANCELLED_REJECTED_TTL_MS;
}

function normalizeToCanonicalPrefType(
  type: NotificationEventTypeAlias
): TargetedNotificationEventType | null {
  switch (type) {
    case 'ORDER_WAITING_APPROVAL':
      return 'ORDER_WAITING_APPROVAL';
    case 'ORDER_PENDING_PREP':
    case 'ORDER_TO_PREPARE':
      return 'ORDER_PENDING_PREP';
    case 'ORDER_ASSIGNED':
      return 'ORDER_ASSIGNED';
    case 'ORDER_READY':
    case 'ORDER_READY_FOR_PICKUP':
      return 'ORDER_READY';
    case 'ORDER_MODIFIED_OR_CANCELLED':
    case 'ORDER_REJECTED':
    case 'ORDER_CANCELLED':
    case 'ORDER_MODIFIED':
      return 'ORDER_MODIFIED_OR_CANCELLED';
    case 'ORDER_PICKUP_DELEGATED':
      return 'ORDER_PICKUP_DELEGATED';
    case 'ORDER_COLLECTED':
      return 'ORDER_COLLECTED';
    case 'TRANSFER_EVENT':
    case 'TRANSFER_INCOMING':
    case 'TRANSFER_ANOMALY_OR_RETURN':
    case 'TRANSFER_OVERDUE':
      return 'TRANSFER_EVENT';
    default:
      return null;
  }
}

export function getDefaultNotificationTypePreferences(): UserNotificationPreferencesMap {
  return {
    ORDER_WAITING_APPROVAL: { beep: true, banner: true },
    ORDER_PENDING_PREP: { beep: true, banner: true },
    ORDER_ASSIGNED: { beep: true, banner: true },
    ORDER_READY: { beep: true, banner: true },
    ORDER_MODIFIED_OR_CANCELLED: { beep: true, banner: true },
    ORDER_PICKUP_DELEGATED: { beep: true, banner: true },
    ORDER_COLLECTED: { beep: true, banner: true },
    TRANSFER_EVENT: { beep: true, banner: true },
  };
}

function getStorageKeyForUser(userId?: string | number | null): string {
  const suffix =
    userId !== undefined && userId !== null && String(userId).trim() !== ''
      ? `_${String(userId).trim()}`
      : '';
  return `${NOTIFICATION_PREFS_STORAGE_PREFIX}${suffix}`;
}

export function getNotificationTypePreferences(
  userId?: string | number | null
): UserNotificationPreferencesMap {
  const defaults = getDefaultNotificationTypePreferences();
  try {
    if (typeof localStorage === 'undefined') return defaults;
    const raw =
      localStorage.getItem(getStorageKeyForUser(userId)) ||
      localStorage.getItem(NOTIFICATION_PREFS_STORAGE_PREFIX);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;
    for (const type of ALL_TARGETED_NOTIFICATION_TYPES) {
      const entry = parsed[type];
      if (entry && typeof entry === 'object') {
        defaults[type] = {
          beep: typeof entry.beep === 'boolean' ? entry.beep : true,
          banner: typeof entry.banner === 'boolean' ? entry.banner : true,
        };
      }
    }
    return defaults;
  } catch {
    return defaults;
  }
}

export function setNotificationTypePreference(
  type: TargetedNotificationEventType,
  channel: 'beep' | 'banner',
  enabled: boolean,
  userId?: string | number | null
): UserNotificationPreferencesMap {
  const current = getNotificationTypePreferences(userId);
  const next: UserNotificationPreferencesMap = {
    ...current,
    [type]: {
      ...current[type],
      [channel]: Boolean(enabled),
    },
  };
  try {
    if (typeof localStorage !== 'undefined') {
      const serialized = JSON.stringify(next);
      localStorage.setItem(getStorageKeyForUser(userId), serialized);
      localStorage.setItem(NOTIFICATION_PREFS_STORAGE_PREFIX, serialized);
    }
  } catch {}
  return next;
}

export interface NotificationChannelCheckOptions {
  type?: NotificationEventTypeAlias;
  eventType?: NotificationEventTypeAlias;
  user?: User | null;
  userId?: string | number | null;
  notifKey?: string | null;
  dismissedKeys?: ReadonlySet<string>;
  order?: Partial<MaterialOrder>;
  depots?: Depot[];
  roles?: Role[];
}

export function shouldEmitNotificationBeep(
  typeOrOptions: NotificationEventTypeAlias | NotificationChannelCheckOptions,
  userId?: string | number | null,
  notifKey?: string | null,
  dismissedKeys?: ReadonlySet<string>
): boolean {
  let resolvedType: NotificationEventTypeAlias;
  let resolvedUserId: string | number | null | undefined = userId;
  let resolvedNotifKey: string | null | undefined = notifKey;
  let resolvedDismissedKeys: ReadonlySet<string> | undefined = dismissedKeys;

  if (typeOrOptions && typeof typeOrOptions === 'object') {
    resolvedType = (typeOrOptions.eventType || typeOrOptions.type || 'ORDER_READY') as NotificationEventTypeAlias;
    resolvedUserId = typeOrOptions.userId ?? typeOrOptions.user?.id;
    resolvedNotifKey = typeOrOptions.notifKey;
    resolvedDismissedKeys = typeOrOptions.dismissedKeys;
  } else {
    resolvedType = typeOrOptions;
  }

  if (resolvedNotifKey) {
    const cleanKey = String(resolvedNotifKey).trim();
    if (cleanKey) {
      if (resolvedDismissedKeys && resolvedDismissedKeys.has(cleanKey)) return false;
      const localDismissed = getDismissedKeysSync(resolvedUserId);
      if (localDismissed.has(cleanKey)) return false;
    }
  }
  const canonical = normalizeToCanonicalPrefType(resolvedType);
  if (!canonical) return true;
  const prefs = getNotificationTypePreferences(resolvedUserId);
  return Boolean(prefs[canonical]?.beep ?? true);
}

export function shouldShowNotificationBanner(
  typeOrOptions: NotificationEventTypeAlias | NotificationChannelCheckOptions,
  userId?: string | number | null,
  notifKey?: string | null,
  dismissedKeys?: ReadonlySet<string>
): boolean {
  let resolvedType: NotificationEventTypeAlias;
  let resolvedUserId: string | number | null | undefined = userId;
  let resolvedNotifKey: string | null | undefined = notifKey;
  let resolvedDismissedKeys: ReadonlySet<string> | undefined = dismissedKeys;

  if (typeOrOptions && typeof typeOrOptions === 'object') {
    resolvedType = (typeOrOptions.eventType || typeOrOptions.type || 'ORDER_READY') as NotificationEventTypeAlias;
    resolvedUserId = typeOrOptions.userId ?? typeOrOptions.user?.id;
    resolvedNotifKey = typeOrOptions.notifKey;
    resolvedDismissedKeys = typeOrOptions.dismissedKeys;
  } else {
    resolvedType = typeOrOptions;
  }

  if (resolvedNotifKey) {
    const cleanKey = String(resolvedNotifKey).trim();
    if (cleanKey) {
      if (resolvedDismissedKeys && resolvedDismissedKeys.has(cleanKey)) return false;
      const localDismissed = getDismissedKeysSync(resolvedUserId);
      if (localDismissed.has(cleanKey)) return false;
    }
  }
  const canonical = normalizeToCanonicalPrefType(resolvedType);
  if (!canonical) return true;
  const prefs = getNotificationTypePreferences(resolvedUserId);
  return Boolean(prefs[canonical]?.banner ?? true);
}

export function getNotificationTypeLabel(
  type: NotificationEventTypeAlias,
  lang: 'fr' | 'en' | 'nl' = 'fr'
): string {
  const canonical = normalizeToCanonicalPrefType(type) || 'ORDER_READY';
  const labels: Record<TargetedNotificationEventType, { fr: string; en: string; nl: string }> = {
    ORDER_WAITING_APPROVAL: {
      fr: 'Commande à valider (seuil budgétaire)',
      en: 'Order awaiting approval (budget threshold)',
      nl: 'Te valideren bestelling (budgetdrempel)',
    },
    ORDER_PENDING_PREP: {
      fr: 'Nouvelle commande à préparer',
      en: 'New order to prepare',
      nl: 'Nieuwe klaar te zetten bestelling',
    },
    ORDER_ASSIGNED: {
      fr: 'Commande assignée à un préparateur',
      en: 'Order assigned to a preparer',
      nl: 'Bestelling toegewezen aan een orderpicker',
    },
    ORDER_READY: {
      fr: 'Commande prête au retrait',
      en: 'Order ready for pickup',
      nl: 'Bestelling klaar voor afhaling',
    },
    ORDER_MODIFIED_OR_CANCELLED: {
      fr: 'Commande refusée, annulée ou modifiée',
      en: 'Order rejected, cancelled or modified',
      nl: 'Bestelling geweigerd, geannuleerd of gewijzigd',
    },
    ORDER_PICKUP_DELEGATED: {
      fr: 'Retrait transféré à un collègue',
      en: 'Pickup delegated to a colleague',
      nl: 'Afhaling overgedragen aan een collega',
    },
    ORDER_COLLECTED: {
      fr: 'Commande retirée',
      en: 'Order collected',
      nl: 'Bestelling afgehaald',
    },
    TRANSFER_EVENT: {
      fr: 'Transferts inter-dépôts (réception, confirmation, litige)',
      en: 'Inter-depot transfers (receipt, confirmation, dispute)',
      nl: 'Overdrachten tussen depots (ontvangst, bevestiging, geschil)',
    },
  };
  return labels[canonical]?.[lang] || labels[canonical]?.fr || String(type);
}

function sameId(a?: string | number | null, b?: string | number | null): boolean {
  if (a === undefined || a === null || b === undefined || b === null) return false;
  const sa = String(a).trim();
  const sb = String(b).trim();
  return sa.length > 0 && sa === sb;
}

/**
 * Calcule l'union des dépôts attribués à `user` :
 * - entrées non vides de `user.allowed_depots`
 * - dépôts dont `user` est titulaire dans `depotHolders`
 * - dépôts dont `user` est `manager_id` dans `depots`
 */
export function getAssignedDepotsForPreparer(params: {
  user: User | null | undefined;
  depotHolders?: Array<{ depot_id: string | number; user_id: string | number }>;
  depots?: Depot[];
}): string[] {
  const { user, depotHolders = [], depots = [] } = params;
  if (!user || user.id === undefined || user.id === null) return [];

  const assigned = new Set<string>();
  if (Array.isArray(user.allowed_depots)) {
    for (const entry of user.allowed_depots) {
      const clean = String(entry ?? '').trim();
      if (clean) {
        assigned.add(clean);
      }
    }
  }

  for (const holder of depotHolders) {
    if (sameId(holder.user_id, user.id)) {
      const dId = String(holder.depot_id ?? '').trim();
      if (dId) {
        assigned.add(dId);
        const foundDepot = depots.find((d) => sameId(d.id, dId));
        if (foundDepot && foundDepot.name) {
          assigned.add(foundDepot.name.trim());
        }
      }
    }
  }

  for (const depot of depots) {
    if (sameId(depot.manager_id, user.id)) {
      const dId = String(depot.id ?? '').trim();
      if (dId) assigned.add(dId);
      if (depot.name) assigned.add(depot.name.trim());
    }
  }

  return Array.from(assigned);
}

/**
 * Indique si l'utilisateur est un préparateur non-admin sans aucun dépôt attribué
 * (pour afficher l'avertissement orange dans la fiche utilisateur).
 */
export function shouldWarnPreparerWithoutDepot(params: {
  user: Partial<User> | null | undefined;
  depotHolders?: Array<{ depot_id: string | number; user_id: string | number }>;
  depots?: Depot[];
  roles?: Role[];
}): boolean {
  const { user, depotHolders = [], depots = [], roles = [] } = params;
  if (!user) return false;
  const roleIdNum = Number(user.role_id);
  const isAdminRole = roleIdNum === 0 || roleIdNum === 1;
  if (isAdminRole) return false;

  let isPreparerUser = Boolean(user.is_preparer);
  if (!isPreparerUser) {
    const roleObj = roles.find((r) => Number(r.id) === roleIdNum);
    if (roleObj && Array.isArray(roleObj.permissions)) {
      isPreparerUser = roleObj.permissions.includes('perm_prepare_orders');
    }
  }
  if (!isPreparerUser) return false;

  const assigned = getAssignedDepotsForPreparer({
    user: user as User,
    depotHolders,
    depots,
  });
  return assigned.length === 0;
}

/**
 * Vérifie si l'utilisateur est un préparateur autorisé sur le dépôt de la commande (v58) :
 * 1. Commande déjà assignée à ce préparateur (`preparer_id == user.id`) : toujours visible par lui (`true`).
 * 2. Les rôles 0 et 1 gardent « tous les dépôts » par défaut (`true`).
 * 3. Pour un préparateur non-admin (`is_preparer === true` ou permission `perm_prepare_orders`, rôle ni 0 ni 1) :
 *    - dépôts attribués = union de `user.allowed_depots` (hors vide) et des dépôts dont l'utilisateur est titulaire dans `depotHolders` ;
 *    - `allowed_depots` vide (`[]` ou `undefined`) et aucun `depotHolders` = aucun dépôt attribué -> retourne `false` ;
 *    - `['*']` explicite reste « tous les dépôts » (`true`).
 * 4. Commande sans dépôt renseigné : visible par tous les préparateurs disposant d'au moins un dépôt (ou admin).
 */
export function isUserAuthorizedPreparerForOrder(params: {
  user: User;
  order: Partial<Pick<MaterialOrder, 'depot_name' | 'items' | 'preparer_id'>> & {
    depot_id?: string | number | null;
  };
  roles?: Role[];
  depots?: Depot[];
  depotHolders?: Array<{ depot_id: string | number; user_id: string | number }>;
}): boolean {
  const { user, order, roles = [], depots = [], depotHolders = [] } = params;
  if (!user || user.id === undefined || user.id === null) return false;

  // Commande déjà assignée à ce préparateur : toujours visible par lui
  if (sameId((order as any)?.preparer_id, user.id)) {
    return true;
  }

  const roleIdNum = Number(user.role_id);
  const isAdminRole = roleIdNum === 0 || roleIdNum === 1;

  // Les rôles 0 et 1 gardent « tous les dépôts » par défaut
  if (isAdminRole) {
    const allowed = user.allowed_depots;
    if (!allowed || allowed.length === 0 || allowed.includes('*')) {
      return true;
    }
  }

  const hasHolderEntry = depotHolders.some((h) => sameId(h.user_id, user.id));
  const hasAllowedDepots = Array.isArray(user.allowed_depots) && user.allowed_depots.length > 0;
  let isPreparerUser = Boolean(user.is_preparer);
  if (!isPreparerUser && !isAdminRole) {
    const roleObj = roles.find((r) => Number(r.id) === roleIdNum);
    if (roleObj && Array.isArray(roleObj.permissions)) {
      isPreparerUser = roleObj.permissions.includes('perm_prepare_orders');
    }
    if (!isPreparerUser && user.is_preparer === undefined && (hasHolderEntry || hasAllowedDepots)) {
      isPreparerUser = true;
    }
  }

  if (!isPreparerUser && !isAdminRole) {
    return false;
  }

  const assignedDepots = getAssignedDepotsForPreparer({
    user,
    depotHolders,
    depots,
  });

  // Aucun dépôt attribué pour un préparateur non-admin -> false
  if (assignedDepots.length === 0) {
    return isAdminRole;
  }

  // ['*'] explicite reste « tous les dépôts »
  if (assignedDepots.includes('*')) {
    return true;
  }

  const orderDepotId = (order as any)?.depot_id ? String((order as any).depot_id).trim() : '';
  const orderDepotName = order?.depot_name ? String(order.depot_name).trim() : '';

  // Commande sans dépôt renseigné : visible par tous les préparateurs
  if (!orderDepotId && !orderDepotName) {
    return true;
  }

  const matchedDepot = depots.find(
    (d) =>
      (orderDepotId && String(d.id) === orderDepotId) ||
      (orderDepotName && d.name.trim().toLowerCase() === orderDepotName.toLowerCase())
  );

  return assignedDepots.some((allowedEntry) => {
    const cleanAllowed = String(allowedEntry).trim();
    if (!cleanAllowed) return false;
    if (cleanAllowed === '*') return true;
    if (orderDepotId && cleanAllowed === orderDepotId) return true;
    if (orderDepotName && cleanAllowed.toLowerCase() === orderDepotName.toLowerCase()) return true;
    if (matchedDepot) {
      if (cleanAllowed === String(matchedDepot.id)) return true;
      if (cleanAllowed.toLowerCase() === matchedDepot.name.trim().toLowerCase()) return true;
    }
    return false;
  });
}

/**
 * Vérifie si l'utilisateur est le responsable (`manager_id`) ou un adjoint (`deputy_manager_ids`)
 * du département ou du projet de la commande. Filtrage strictement par ID utilisateur.
 */
export function isUserApproverForOrderDepartment(params: {
  user: User;
  order: Partial<MaterialOrder> & {
    department?: string;
    department_id?: string | number | null;
  };
  users?: User[];
  departments?: Department[];
  projects?: Project[];
}): boolean {
  const { user, order, users = [], departments = [], projects = [] } = params;
  if (!user || user.id === undefined || user.id === null) return false;

  const requester = users.find((u) => sameId(u.id, order.requester_id));
  const targetDeptId = (order as any).department_id ?? (requester as any)?.department_id;
  const targetDeptKey = String(
    order.requester_department || (order as any).department || requester?.department || ''
  )
    .trim()
    .toLowerCase();

  for (const dept of departments) {
    const matchesById =
      targetDeptId !== undefined &&
      targetDeptId !== null &&
      sameId(dept.id, targetDeptId);
    const matchesByCode =
      !matchesById &&
      targetDeptKey.length > 0 &&
      (String(dept.id).toLowerCase() === targetDeptKey ||
        dept.name.trim().toLowerCase() === targetDeptKey);

    if (matchesById || matchesByCode) {
      if (sameId(dept.manager_id, user.id)) return true;
      if (
        Array.isArray(dept.deputy_manager_ids) &&
        dept.deputy_manager_ids.some((depId) => sameId(depId, user.id))
      ) {
        return true;
      }
    }
  }

  if (order.site_number && projects.length > 0) {
    const siteKey = String(order.site_number).trim().toLowerCase();
    const matchedProj = projects.find(
      (p) => String(p.project_number || '').trim().toLowerCase() === siteKey
    );
    if (matchedProj) {
      if (sameId(matchedProj.manager_id, user.id)) return true;
      if (
        Array.isArray(matchedProj.deputy_manager_ids) &&
        matchedProj.deputy_manager_ids.some((id) => sameId(id, user.id))
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Détermine si `user` est destinataire légitime d'une alerte de stock bas ou rupture sur un article/dépôt.
 */
export function isUserRecipientForStockAlert(params: {
  product?: (Partial<Product> & { depot_name?: string; department?: string }) | null;
  depotIdOrName?: string | number | null;
  user: User | null | undefined;
  departments?: Department[];
  depots?: Depot[];
  depotHolders?: Array<{ depot_id: string | number; user_id: string | number }>;
  roles?: Role[];
  dismissedKeys?: ReadonlySet<string>;
  alertStatus?: 'LOW' | 'OUT' | string;
}): boolean {
  const {
    product,
    depotIdOrName,
    user,
    departments = [],
    depots = [],
    depotHolders = [],
    roles = [],
    dismissedKeys,
    alertStatus,
  } = params;
  if (!user || user.id === undefined || user.id === null) return false;

  if (product?.id !== undefined && product?.id !== null) {
    const computedStatus =
      alertStatus ||
      (Number(product.quantity ?? 0) <= 0 ? 'OUT' : 'LOW');
    const stockKey = buildNotificationKey('STOCK_LOW_ALERT', product.id, computedStatus);
    if (dismissedKeys && dismissedKeys.has(stockKey)) return false;
    const localDismissed = getDismissedKeysSync(user.id);
    if (localDismissed.has(stockKey)) return false;
  }

  const targetDepotRaw = String(
    depotIdOrName ?? (product as any)?.depot_name ?? product?.store_name ?? ''
  ).trim();
  if (targetDepotRaw) {
    const matchedDepot = depots.find(
      (d) =>
        sameId(d.id, targetDepotRaw) ||
        d.name.trim().toLowerCase() === targetDepotRaw.toLowerCase()
    );
    const depotId = matchedDepot ? matchedDepot.id : targetDepotRaw;

    if (matchedDepot && sameId(matchedDepot.manager_id, user.id)) {
      return true;
    }
    if (
      depotHolders.some(
        (h) => sameId(h.depot_id, depotId) && sameId(h.user_id, user.id)
      )
    ) {
      return true;
    }
    const roleIdNum = Number(user.role_id);
    const isAdminRole = roleIdNum === 0 || roleIdNum === 1;
    const hasExplicitDepots =
      Array.isArray(user.allowed_depots) &&
      user.allowed_depots.length > 0 &&
      !user.allowed_depots.includes('*');
    if (
      (!isAdminRole || Boolean(user.is_preparer) || hasExplicitDepots) &&
      isUserAuthorizedPreparerForOrder({
        user,
        order: { depot_name: matchedDepot?.name || targetDepotRaw, depot_id: depotId, items: [] },
        depots,
        depotHolders,
        roles,
      })
    ) {
      return true;
    }
  } else if (Boolean(user.is_preparer)) {
    const assigned = getAssignedDepotsForPreparer({ user, depotHolders, depots });
    if (assigned.length > 0 || Number(user.role_id) === 0 || Number(user.role_id) === 1) {
      return true;
    }
  }

  const rawProdDept = (product as any)?.department;
  if (rawProdDept) {
    const prodDept = String(rawProdDept).trim().toLowerCase();
    for (const dept of departments) {
      if (
        sameId(dept.id, prodDept) ||
        dept.name.trim().toLowerCase() === prodDept
      ) {
        if (sameId(dept.manager_id, user.id)) return true;
        if (
          Array.isArray(dept.deputy_manager_ids) &&
          dept.deputy_manager_ids.some((id) => sameId(id, user.id))
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

export interface OrderNotificationRecipientContext {
  user: User | null | undefined;
  order: MaterialOrder & {
    depot_id?: string | number | null;
    department_id?: string | number | null;
    department?: string;
  };
  eventType: NotificationEventTypeAlias;
  users?: User[];
  departments?: Department[];
  projects?: Project[];
  depots?: Depot[];
  depotHolders?: Array<{ depot_id: string | number; user_id: string | number }>;
  roles?: Role[];
}

/**
 * Détermine si `user` est destinataire légitime d'un événement de commande donné.
 * - Filtrage exclusivement par identifiant (`requester_id`, `preparer_id`, `pickup_delegate_id`,
 *   `manager_id` / `deputy_manager_ids`), JAMAIS par nom.
 * - Un administrateur (rôle 0/1) ne reçoit pas les notifications des autres.
 */
export function isUserRecipientForOrderEvent(ctx: OrderNotificationRecipientContext): boolean {
  const {
    user,
    order,
    eventType,
    users = [],
    departments = [],
    projects = [],
    depots = [],
    depotHolders = [],
    roles = [],
  } = ctx;
  if (!user || user.id === undefined || user.id === null) return false;

  switch (eventType) {
    case 'ORDER_WAITING_APPROVAL': {
      return isUserApproverForOrderDepartment({
        user,
        order,
        users,
        departments,
        projects,
      });
    }

    case 'ORDER_PENDING_PREP':
    case 'ORDER_TO_PREPARE': {
      const roleIdNum = Number(user.role_id);
      const isAdminRole = roleIdNum === 0 || roleIdNum === 1;
      if (isAdminRole && !user.is_preparer) {
        return false;
      }
      return isUserAuthorizedPreparerForOrder({
        user,
        order,
        roles,
        depots,
        depotHolders,
      });
    }

    case 'ORDER_ASSIGNED': {
      return sameId(order.preparer_id, user.id);
    }

    case 'ORDER_READY':
    case 'ORDER_READY_FOR_PICKUP': {
      return (
        sameId(order.requester_id, user.id) ||
        sameId(order.pickup_delegate_id, user.id)
      );
    }

    case 'ORDER_REJECTED':
    case 'ORDER_CANCELLED':
    case 'ORDER_MODIFIED':
    case 'ORDER_MODIFIED_OR_CANCELLED': {
      return (
        sameId(order.requester_id, user.id) ||
        sameId(order.preparer_id, user.id)
      );
    }

    case 'ORDER_PICKUP_DELEGATED': {
      return (
        sameId(order.pickup_delegate_id, user.id) ||
        sameId(order.requester_id, user.id) ||
        sameId(order.preparer_id, user.id)
      );
    }

    case 'ORDER_COLLECTED': {
      return (
        sameId(order.requester_id, user.id) ||
        sameId(order.preparer_id, user.id)
      );
    }

    default:
      return false;
  }
}

export interface TransferNotificationRecipientContext {
  user: User | null | undefined;
  transfer: Partial<StockTransfer> & {
    from_depot_id?: string | number | null;
    to_depot_id?: string | number | null;
    source_depot_id?: string | number | null;
    dest_depot_id?: string | number | null;
    source_depot?: string | null;
    dest_depot?: string | null;
    sender_id?: string | number | null;
    receiver_id?: string | number | null;
    status?: string;
  };
  eventType?: NotificationEventTypeAlias;
  depotHolders?: Array<{ depot_id: string | number; user_id: string | number }>;
  depots?: Depot[];
  roles?: Role[];
  hasReceiveAllPerm?: boolean;
}

/**
 * Détermine si `user` est destinataire d'une notification de transfert (réception, confirmation, litige v54) :
 * - Titulaires du dépôt concerné (`depotHolders` ou `depot.manager_id` par ID),
 * - Émetteur (`sender_id`),
 * - Logistique (utilisateur avec attribut/rôle logistique non-admin).
 * - Un administrateur (rôle 0/1) ne reçoit pas les notifications des autres s'il n'est ni titulaire ni émetteur.
 */
export function isUserRecipientForTransferEvent(
  ctx: TransferNotificationRecipientContext
): boolean {
  const { user, transfer, eventType, depotHolders = [], depots = [], roles = [] } = ctx;
  if (!user || user.id === undefined || user.id === null) return false;

  const isIncomingOnly = eventType === 'TRANSFER_INCOMING';

  // 1. Émetteur du transfert (sauf si l'événement est strictement l'arrivée côté destinataire)
  if (!isIncomingOnly && sameId(transfer.sender_id, user.id)) {
    return true;
  }

  // 2. Résoudre les IDs des dépôts source et destination
  const resolveDepotId = (rawId?: string | number | null, rawName?: string | null) => {
    if (rawId !== undefined && rawId !== null && String(rawId).trim() !== '') {
      return String(rawId).trim();
    }
    if (rawName && String(rawName).trim() !== '') {
      const found = depots.find(
        (d) => d.name.trim().toLowerCase() === String(rawName).trim().toLowerCase()
      );
      if (found) return String(found.id);
    }
    return '';
  };

  const srcId = resolveDepotId(transfer.from_depot_id ?? transfer.source_depot_id, transfer.source_depot);
  const dstId = resolveDepotId(transfer.to_depot_id ?? transfer.dest_depot_id, transfer.dest_depot);

  const concernedDepotIds = (isIncomingOnly ? [dstId] : [srcId, dstId]).filter(Boolean);

  for (const dId of concernedDepotIds) {
    if (
      depotHolders.some(
        (h) => sameId(h.depot_id, dId) && sameId(h.user_id, user.id)
      )
    ) {
      return true;
    }
    const depotObj = depots.find((d) => sameId(d.id, dId));
    if (depotObj && sameId(depotObj.manager_id, user.id)) {
      return true;
    }
  }

  // 3. Logistique (hors simple admin 0/1 qui n'est pas explicitement logistique)
  const roleIdNum = Number(user.role_id);
  const isAdminRole = roleIdNum === 0 || roleIdNum === 1;
  const isExplicitLogistics = Boolean((user as any).is_logistics);
  if (isExplicitLogistics) {
    return true;
  }

  if (!isAdminRole) {
    const roleObj = roles.find((r) => Number(r.id) === roleIdNum);
    const isLogisticsRole =
      roleObj &&
      (/logisti/i.test(roleObj.name || '') ||
        (Array.isArray(roleObj.permissions) &&
          roleObj.permissions.includes('perm_manage_transfers')));
    if (isLogisticsRole) {
      return true;
    }
  }

  return false;
}

export interface TargetedOrderNotificationItem {
  order: MaterialOrder;
  notificationType: TargetedNotificationEventType;
  eventType: NotificationEventTypeAlias;
  notifKey: string;
}

export interface TargetedTransferNotificationItem {
  transfer: Partial<StockTransfer>;
  notificationType: 'TRANSFER_EVENT';
  eventType: NotificationEventTypeAlias;
  notifKey: string;
  isOverdue7Days?: boolean;
  isWarning5Days?: boolean;
  ageDays?: number;
}

export interface TargetedStockAlertNotificationItem {
  product: Product;
  alertStatus: 'LOW' | 'OUT';
  notifKey: string;
}

/**
 * Descripteur d'affichage d'une carte de notification dans NotificationsModal / DesktopShell.
 */
export interface NotificationCardDescriptor {
  title: string;
  subtitle: string;
  actionLabel: string;
  colorScheme: 'emerald' | 'amber' | 'blue' | 'purple' | 'rose' | 'slate';
  iconName: 'CheckCircle2' | 'Clock' | 'Package' | 'UserCheck' | 'XCircle' | 'Truck' | 'AlertTriangle';
  reason?: string;
  author?: string;
  autoDismissOnOpen: boolean;
}

export function getNotificationCardDescriptor(
  item: TargetedOrderNotificationItem,
  lang: 'fr' | 'en' | 'nl' = 'fr'
): NotificationCardDescriptor {
  const { order, notificationType } = item;
  const status = order.status;
  const orderNumber = order.order_number || `#${order.id}`;

  if (notificationType === 'ORDER_MODIFIED_OR_CANCELLED' || status === 'CANCELLED' || status === 'REJECTED') {
    const isRejected = status === 'REJECTED';
    const reason =
      (isRejected ? order.rejection_reason : order.cancellation_reason) ||
      order.cancellation_reason ||
      order.rejection_reason ||
      '';
    const author =
      (isRejected ? order.rejected_by : order.cancelled_by) ||
      order.cancelled_by ||
      order.rejected_by ||
      '';

    const titles = {
      fr: isRejected
        ? `Commande refusée — ${orderNumber}`
        : `Commande annulée — ${orderNumber}`,
      en: isRejected
        ? `Order rejected — ${orderNumber}`
        : `Order cancelled — ${orderNumber}`,
      nl: isRejected
        ? `Bestelling geweigerd — ${orderNumber}`
        : `Bestelling geannuleerd — ${orderNumber}`,
    };
    const actions = {
      fr: 'Voir le détail',
      en: 'View details',
      nl: 'Details bekijken',
    };

    return {
      title: titles[lang] || titles.fr,
      subtitle: order.site_number || order.depot_name || '',
      actionLabel: actions[lang] || actions.fr,
      colorScheme: 'rose',
      iconName: 'XCircle',
      reason: reason || undefined,
      author: author || undefined,
      autoDismissOnOpen: true,
    };
  }

  if (notificationType === 'ORDER_WAITING_APPROVAL' || status === 'WAITING_APPROVAL') {
    const titles = {
      fr: `Commande ${orderNumber} à valider`,
      en: `Order ${orderNumber} awaiting approval`,
      nl: `Bestelling ${orderNumber} te valideren`,
    };
    const actions = {
      fr: 'Examiner la demande',
      en: 'Review request',
      nl: 'Aanvraag beoordelen',
    };
    return {
      title: titles[lang] || titles.fr,
      subtitle: order.requester_name || order.site_number || '',
      actionLabel: actions[lang] || actions.fr,
      colorScheme: 'amber',
      iconName: 'Clock',
      autoDismissOnOpen: false,
    };
  }

  if (notificationType === 'ORDER_PENDING_PREP' || status === 'PENDING') {
    const titles = {
      fr: `Nouvelle commande ${orderNumber} à préparer`,
      en: `New order ${orderNumber} to prepare`,
      nl: `Nieuwe bestelling ${orderNumber} klaar te zetten`,
    };
    const actions = {
      fr: 'Ouvrir la préparation',
      en: 'Open picking',
      nl: 'Orderpicken openen',
    };
    return {
      title: titles[lang] || titles.fr,
      subtitle: order.depot_name || order.requester_name || '',
      actionLabel: actions[lang] || actions.fr,
      colorScheme: 'blue',
      iconName: 'Package',
      autoDismissOnOpen: false,
    };
  }

  if (notificationType === 'ORDER_ASSIGNED' || status === 'PREPARING') {
    const titles = {
      fr: `Commande ${orderNumber} assignée`,
      en: `Order ${orderNumber} assigned`,
      nl: `Bestelling ${orderNumber} toegewezen`,
    };
    const actions = {
      fr: 'Poursuivre la préparation',
      en: 'Continue picking',
      nl: 'Orderpicken voortzetten',
    };
    return {
      title: titles[lang] || titles.fr,
      subtitle: order.depot_name || order.requester_name || '',
      actionLabel: actions[lang] || actions.fr,
      colorScheme: 'purple',
      iconName: 'UserCheck',
      autoDismissOnOpen: false,
    };
  }

  if (notificationType === 'ORDER_PICKUP_DELEGATED') {
    const titles = {
      fr: `Retrait délégué — Commande ${orderNumber} prête`,
      en: `Delegated pickup — Order ${orderNumber} ready`,
      nl: `Overgedragen afhaling — Bestelling ${orderNumber} klaar`,
    };
    const actions = {
      fr: 'Voir le bon de retrait',
      en: 'View pickup slip',
      nl: 'Afhaalbon bekijken',
    };
    return {
      title: titles[lang] || titles.fr,
      subtitle: order.pickup_delegate_name || order.depot_name || '',
      actionLabel: actions[lang] || actions.fr,
      colorScheme: 'emerald',
      iconName: 'CheckCircle2',
      autoDismissOnOpen: false,
    };
  }

  if (notificationType === 'ORDER_COLLECTED' || status === 'COLLECTED') {
    const titles = {
      fr: `Commande ${orderNumber} retirée`,
      en: `Order ${orderNumber} collected`,
      nl: `Bestelling ${orderNumber} afgehaald`,
    };
    const actions = {
      fr: 'Voir le détail',
      en: 'View details',
      nl: 'Details bekijken',
    };
    return {
      title: titles[lang] || titles.fr,
      subtitle: order.collected_by || order.requester_name || '',
      actionLabel: actions[lang] || actions.fr,
      colorScheme: 'slate',
      iconName: 'CheckCircle2',
      autoDismissOnOpen: true,
    };
  }

  // Par défaut : ORDER_READY
  const readyTitles = {
    fr: '🎉 Commande prête au magasin !',
    en: '🎉 Order ready at store!',
    nl: '🎉 Bestelling klaar in het magazijn!',
  };
  const readyActions = {
    fr: 'Voir le bon de retrait',
    en: 'View pickup slip',
    nl: 'Afhaalbon bekijken',
  };
  return {
    title: readyTitles[lang] || readyTitles.fr,
    subtitle: order.depot_name || order.site_number || '',
    actionLabel: readyActions[lang] || readyActions.fr,
    colorScheme: 'emerald',
    iconName: 'CheckCircle2',
    autoDismissOnOpen: false,
  };
}

/**
 * Calcule la liste des commandes actives qui doivent réellement apparaître dans la cloche
 * de notifications de `user` (en appliquant la matrice destinataire × statut, les préférences de bandeau,
 * l'exclusion des `dismissedKeys` et le garde-fou des 7 jours pour les commandes annulées/refusées).
 */
export function getTargetedOrderNotificationsForUser(params: {
  user: User | null | undefined;
  orders: MaterialOrder[];
  users?: User[];
  departments?: Department[];
  projects?: Project[];
  depots?: Depot[];
  depotHolders?: Array<{ depot_id: string | number; user_id: string | number }>;
  roles?: Role[];
  respectBannerPrefs?: boolean;
  dismissedKeys?: ReadonlySet<string>;
  nowMs?: number;
}): TargetedOrderNotificationItem[] {
  const {
    user,
    orders,
    users = [],
    departments = [],
    projects = [],
    depots = [],
    depotHolders = [],
    roles = [],
    respectBannerPrefs = true,
    dismissedKeys = new Set<string>(),
    nowMs = Date.now(),
  } = params;
  if (!user || user.id === undefined || user.id === null) return [];

  const result: TargetedOrderNotificationItem[] = [];

  for (const order of orders) {
    // Garde-fou d'ancienneté : > 7 jours pour CANCELLED / REJECTED
    if (isOrderNotificationExpired(order, nowMs)) {
      continue;
    }

    let matchedType: TargetedNotificationEventType | null = null;

    if (order.status === 'WAITING_APPROVAL') {
      if (
        isUserRecipientForOrderEvent({
          user,
          order,
          eventType: 'ORDER_WAITING_APPROVAL',
          users,
          departments,
          projects,
          depots,
          depotHolders,
          roles,
        })
      ) {
        matchedType = 'ORDER_WAITING_APPROVAL';
      }
    } else if (order.status === 'PENDING') {
      if (
        isUserRecipientForOrderEvent({
          user,
          order,
          eventType: 'ORDER_PENDING_PREP',
          users,
          departments,
          projects,
          depots,
          depotHolders,
          roles,
        })
      ) {
        matchedType = 'ORDER_PENDING_PREP';
      }
    } else if (order.status === 'PREPARING') {
      if (
        isUserRecipientForOrderEvent({
          user,
          order,
          eventType: 'ORDER_ASSIGNED',
          users,
          departments,
          projects,
          depots,
          depotHolders,
          roles,
        })
      ) {
        matchedType = 'ORDER_ASSIGNED';
      }
    } else if (order.status === 'READY') {
      if (
        order.pickup_delegate_id &&
        isUserRecipientForOrderEvent({
          user,
          order,
          eventType: 'ORDER_PICKUP_DELEGATED',
          users,
          departments,
          projects,
          depots,
          depotHolders,
          roles,
        })
      ) {
        matchedType = 'ORDER_PICKUP_DELEGATED';
      } else if (
        isUserRecipientForOrderEvent({
          user,
          order,
          eventType: 'ORDER_READY',
          users,
          departments,
          projects,
          depots,
          depotHolders,
          roles,
        })
      ) {
        matchedType = 'ORDER_READY';
      }
    } else if (order.status === 'REJECTED' || order.status === 'CANCELLED') {
      if (
        isUserRecipientForOrderEvent({
          user,
          order,
          eventType: 'ORDER_MODIFIED_OR_CANCELLED',
          users,
          departments,
          projects,
          depots,
          depotHolders,
          roles,
        })
      ) {
        matchedType = 'ORDER_MODIFIED_OR_CANCELLED';
      }
    }

    if (matchedType) {
      const notifKey = buildNotificationKey(matchedType, order.id, order.status);
      if (dismissedKeys && dismissedKeys.has(notifKey)) {
        continue;
      }
      if (!respectBannerPrefs || shouldShowNotificationBanner(matchedType, user.id, notifKey, dismissedKeys)) {
        result.push({
          order,
          notificationType: matchedType,
          eventType: matchedType,
          notifKey,
        });
      }
    }
  }

  return result;
}

/**
 * Calcule la liste des transferts actifs destinés à `user` (en excluant `dismissedKeys`).
 * Pour les transferts en transit / en attente depuis >= 5 jours (avertissement J+5) ou >= 7 jours (remise en stock obligatoire J+7),
 * utilise la clé `TRANSFER_OVERDUE:<id>:<status>`.
 */
export function getTargetedTransferNotificationsForUser(params: {
  user: User | null | undefined;
  transfers?: Array<Partial<StockTransfer>>;
  depotHolders?: Array<{ depot_id: string | number; user_id: string | number }>;
  depots?: Depot[];
  roles?: Role[];
  hasReceiveAllPerm?: boolean;
  respectBannerPrefs?: boolean;
  dismissedKeys?: ReadonlySet<string>;
  nowMs?: number;
}): TargetedTransferNotificationItem[] {
  const {
    user,
    transfers = [],
    depotHolders = [],
    depots = [],
    roles = [],
    hasReceiveAllPerm = false,
    respectBannerPrefs = true,
    dismissedKeys = new Set<string>(),
    nowMs = Date.now(),
  } = params;
  if (!user || user.id === undefined || user.id === null) return [];

  if (respectBannerPrefs && !shouldShowNotificationBanner('TRANSFER_EVENT', user.id)) {
    return [];
  }

  const items: TargetedTransferNotificationItem[] = [];
  for (const tr of transfers) {
    const isActionableStatus =
      tr.status === 'IN_TRANSIT' ||
      tr.status === 'AWAITING_SENDER' ||
      tr.status === 'PARTIALLY_RECEIVED';
    if (!isActionableStatus) continue;

    let ageDays = 0;
    if (tr.created_at) {
      const ts = new Date(tr.created_at).getTime();
      if (Number.isFinite(ts)) {
        ageDays = Math.max(0, (nowMs - ts) / (24 * 60 * 60 * 1000));
      }
    }
    const isOverdueStatus = tr.status === 'IN_TRANSIT' || tr.status === 'AWAITING_SENDER';
    const isOverdue7Days = isOverdueStatus && ageDays >= 7;
    const isWarning5Days = isOverdueStatus && ageDays >= 5 && ageDays < 7;
    const isOverdueOrWarning = isOverdue7Days || isWarning5Days;

    const eventType: NotificationEventTypeAlias = isOverdueOrWarning
      ? 'TRANSFER_OVERDUE'
      : 'TRANSFER_EVENT';
    const notifKey = buildNotificationKey(
      eventType,
      tr.id ?? '',
      tr.status ?? 'IN_TRANSIT'
    );
    const legacyKey = buildNotificationKey(
      'TRANSFER_EVENT',
      tr.id ?? '',
      tr.status ?? 'IN_TRANSIT'
    );
    if (
      dismissedKeys &&
      (dismissedKeys.has(notifKey) || (!isOverdueOrWarning && dismissedKeys.has(legacyKey)))
    ) {
      continue;
    }

    if (
      isUserRecipientForTransferEvent({
        user,
        transfer: tr,
        depotHolders,
        depots,
        roles,
        hasReceiveAllPerm,
      })
    ) {
      items.push({
        transfer: tr,
        notificationType: 'TRANSFER_EVENT',
        eventType,
        notifKey,
        isOverdue7Days,
        isWarning5Days,
        ageDays,
      });
    }
  }
  return items;
}

/**
 * Calcule le compteur exact du badge de la cloche de notifications pour `user`
 * (commandes ciblées + transferts ciblés, hors `dismissedKeys`).
 */
export function computeTargetedBellBadgeCount(params: {
  user: User | null | undefined;
  orders: MaterialOrder[];
  transfers?: Array<Partial<StockTransfer>>;
  products?: Product[];
  depotHolders?: Array<{ depot_id: string | number; user_id: string | number }>;
  users?: User[];
  departments?: Department[];
  projects?: Project[];
  depots?: Depot[];
  roles?: Role[];
  hasReceiveAllPerm?: boolean;
  respectBannerPrefs?: boolean;
  dismissedKeys?: ReadonlySet<string>;
  nowMs?: number;
}): number {
  const {
    user,
    orders,
    transfers = [],
    products = [],
    depotHolders = [],
    users = [],
    departments = [],
    projects = [],
    depots = [],
    roles = [],
    hasReceiveAllPerm = false,
    respectBannerPrefs = true,
    dismissedKeys = new Set<string>(),
    nowMs = Date.now(),
  } = params;
  if (!user || user.id === undefined || user.id === null) return 0;

  const targetedOrders = getTargetedOrderNotificationsForUser({
    user,
    orders,
    users,
    departments,
    projects,
    depots,
    depotHolders,
    roles,
    respectBannerPrefs,
    dismissedKeys,
    nowMs,
  });

  const targetedTransfers = getTargetedTransferNotificationsForUser({
    user,
    transfers,
    depotHolders,
    depots,
    roles,
    hasReceiveAllPerm,
    respectBannerPrefs,
    dismissedKeys,
  });

  let targetedStockCount = 0;
  if (Array.isArray(products) && products.length > 0) {
    for (const p of products) {
      if (!p || !p.min_stock_alert || p.min_stock_alert <= 0 || p.quantity > p.min_stock_alert) {
        continue;
      }
      const alertStatus = p.quantity <= 0 ? 'OUT' : 'LOW';
      const stockKey = buildNotificationKey('STOCK_LOW_ALERT', p.id, alertStatus);
      if (dismissedKeys && dismissedKeys.has(stockKey)) continue;
      if (
        respectBannerPrefs &&
        !shouldShowNotificationBanner('STOCK_LOW_ALERT', user.id, stockKey, dismissedKeys)
      ) {
        continue;
      }
      if (
        isUserRecipientForStockAlert({
          product: p,
          user,
          departments,
          depots,
          depotHolders,
          roles,
          dismissedKeys,
          alertStatus,
        })
      ) {
        targetedStockCount++;
      }
    }
  }

  const closedProjectAlerts = getClosedProjectContainerAlertsForUser({
    user,
    projects,
    depots,
    departments,
    dismissedKeys,
  });

  return (
    targetedOrders.length +
    targetedTransfers.length +
    targetedStockCount +
    closedProjectAlerts.length
  );
}
