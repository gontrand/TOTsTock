import { getClientSupabase } from './clientSupabase';
import {
  Depot,
  DepotHolder,
  StockLevelsReportRow,
  StockTransferLine,
  StockTransferRecord,
  StockTransferStatus,
  User,
} from '../types';

export interface ReceiveLineDraft {
  product_id?: string;
  productId?: string;
  mode: 'ACCEPT' | 'MODIFY' | 'REFUSE';
  quantity_received?: number;
  quantityReceived?: number;
  quantitySent?: number;
  reason?: string;
  comment?: string;
}

export interface ReceiveTransferItemOverride {
  product_id: string;
  accepted: boolean;
  quantity_received: number;
  reason?: string;
}

export interface EligibleDestDepot {
  depot: Depot;
  receiverHolders: { user_id: string; name: string; trigram: string }[];
  receiverNamesLabel: string;
  receiverLabel: string;
}

function normalizeDepotKey(val: unknown): string {
  return String(val ?? '').trim().toLowerCase();
}

export function doesHolderMatchDepot(
  holder: DepotHolder,
  depot: Pick<Depot, 'id'> & { name?: string }
): boolean {
  const holderDepotKey = normalizeDepotKey(String(holder.depot_id ?? ''));
  if (!holderDepotKey) return false;
  const depotIdKey = normalizeDepotKey(String(depot.id ?? ''));
  const depotNameKey = normalizeDepotKey(depot.name ?? '');
  return (
    (Boolean(depotIdKey) && holderDepotKey === depotIdKey) ||
    (Boolean(depotNameKey) && holderDepotKey === depotNameKey)
  );
}

export function getDepotHoldersForDepot(
  depot: Depot | { id: string | number; name?: string },
  holders: DepotHolder[],
  users: User[]
): Array<DepotHolder & { user_name: string; user_trigram: string }> {
  const activeUsersMap = new Map<string, User>();
  for (const u of users) {
    if (!u.is_blocked) {
      activeUsersMap.set(String(u.id), u);
    }
  }
  const result: Array<DepotHolder & { user_name: string; user_trigram: string }> = [];
  for (const h of holders) {
    if (!doesHolderMatchDepot(h, depot as Depot)) continue;
    const u = activeUsersMap.get(String(h.user_id));
    if (!u) continue;
    if (!h.can_send && !h.can_receive) continue;
    result.push({
      ...h,
      depot_id: String(h.depot_id),
      user_id: String(h.user_id),
      user_name: u.name,
      user_trigram: u.trigram || '',
    });
  }
  return result.sort((a, b) => a.user_name.localeCompare(b.user_name, 'fr'));
}

export function getDepotReceivers(
  depotOrName: Depot | string | number,
  depotsOrHolders: Depot[] | DepotHolder[],
  holdersOrUsers: DepotHolder[] | User[],
  usersOptional?: User[]
): Array<{ user_id: string; name: string; trigram: string }> {
  let holders: DepotHolder[];
  let users: User[];
  let targetDepot: Depot | undefined;

  if (usersOptional !== undefined) {
    const depots = (depotsOrHolders as Depot[]) || [];
    holders = (holdersOrUsers as DepotHolder[]) || [];
    users = usersOptional || [];
    targetDepot =
      typeof depotOrName === 'object' && depotOrName !== null
        ? depotOrName
        : depots.find(
            (d) =>
              normalizeDepotKey(d.name) === normalizeDepotKey(depotOrName) ||
              normalizeDepotKey(d.id) === normalizeDepotKey(depotOrName)
          );
  } else {
    holders = (depotsOrHolders as DepotHolder[]) || [];
    users = (holdersOrUsers as User[]) || [];
    targetDepot =
      typeof depotOrName === 'object' && depotOrName !== null
        ? depotOrName
        : ({
            id: String(depotOrName),
            name: String(depotOrName),
            type: 'FIXED',
            is_active: true,
          } as Depot);
  }

  if (!targetDepot) return [];

  return getDepotHoldersForDepot(targetDepot, holders, users)
    .filter((h) => h.can_receive === true)
    .map((h) => ({
      user_id: String(h.user_id),
      name: h.user_name,
      trigram: h.user_trigram,
    }));
}

export function depotHasReceiverHolder(
  depot: Depot,
  holders: DepotHolder[],
  users: User[]
): boolean {
  const matched = getDepotHoldersForDepot(depot, holders, users);
  return matched.some((h) => h.can_receive === true);
}

/**
 * Retourne les dépôts sources actifs depuis lesquels l'utilisateur peut expédier un transfert :
 * - Rôles 0 / 1 : tous les dépôts actifs
 * - perm_stock_transfer_store : tous les dépôts fixes (FIXED) actifs
 * - Responsable avec can_send = true dans stk_depot_holders : ce dépôt actif
 */
export function getEligibleSourceDepots(
  user: User | null | undefined,
  depots: Depot[],
  holders: DepotHolder[],
  hasStoreOrTransferPerm: boolean,
  hasStoreTransferPermOptional?: boolean
): Depot[] {
  if (!user || user.is_blocked) return [];
  const hasStoreTransferPerm =
    hasStoreTransferPermOptional !== undefined
      ? Boolean(hasStoreTransferPermOptional)
      : Boolean(hasStoreOrTransferPerm);

  const activeDepots = depots.filter((d) => d.is_active !== false);
  const isAdmin = Number(user.id) === 0 || Number(user.role_id) === 0 || Number(user.role_id) === 1;
  if (isAdmin) {
    return activeDepots;
  }

  const userIdStr = String(user.id);
  return activeDepots.filter((depot) => {
    const isFixed = (depot.type || 'FIXED').toUpperCase() === 'FIXED';
    if (isFixed && hasStoreTransferPerm) {
      return true;
    }
    return holders.some(
      (h) =>
        doesHolderMatchDepot(h, depot) &&
        String(h.user_id) === userIdStr &&
        h.can_send === true
    );
  });
}

/**
 * Indique si le bouton « Transférer » doit être affiché pour l'utilisateur courant.
 * Masqué si l'utilisateur n'a aucun dépôt source éligible.
 */
export function canUserInitiateTransfer(
  user: User | null | undefined,
  depots: Depot[],
  holders: DepotHolder[],
  hasStoreOrTransferPerm: boolean,
  hasStoreTransferPermOptional?: boolean
): boolean {
  return (
    getEligibleSourceDepots(
      user,
      depots,
      holders,
      hasStoreOrTransferPerm,
      hasStoreTransferPermOptional
    ).length > 0
  );
}

/**
 * Retourne les dépôts de destination éligibles :
 * tous les dépôts actifs ayant au moins un responsable « réception » (can_receive = true) actif,
 * avec les noms des responsables.
 * Supporte les deux ordres d'arguments :
 * - `(depots, holders, users, excludeSourceDepotNameOrId?)`
 * - `(excludeSourceDepotNameOrId, depots, holders, users)`
 */
export function getEligibleDestDepots(
  arg1: Depot[] | string,
  arg2: DepotHolder[] | Depot[],
  arg3: User[] | DepotHolder[],
  arg4?: string | User[]
): EligibleDestDepot[] {
  let depots: Depot[];
  let holders: DepotHolder[];
  let users: User[];
  let excludeSourceDepotNameOrId: string | undefined;

  if (typeof arg1 === 'string') {
    excludeSourceDepotNameOrId = arg1;
    depots = (arg2 as Depot[]) || [];
    holders = (arg3 as DepotHolder[]) || [];
    users = (arg4 as User[]) || [];
  } else {
    depots = arg1 || [];
    holders = (arg2 as DepotHolder[]) || [];
    users = (arg3 as User[]) || [];
    excludeSourceDepotNameOrId = typeof arg4 === 'string' ? arg4 : undefined;
  }

  const excludeKey = normalizeDepotKey(excludeSourceDepotNameOrId);
  const activeDepots = depots.filter((d) => d.is_active !== false);
  const out: EligibleDestDepot[] = [];

  for (const depot of activeDepots) {
    if (
      excludeKey &&
      (normalizeDepotKey(depot.id) === excludeKey || normalizeDepotKey(depot.name) === excludeKey)
    ) {
      continue;
    }
    const depotHolders = getDepotHoldersForDepot(depot, holders, users).filter(
      (h) => h.can_receive === true
    );
    if (depotHolders.length === 0) continue;
    const receiverHolders = depotHolders.map((h) => ({
      user_id: String(h.user_id),
      name: h.user_name,
      trigram: h.user_trigram,
    }));
    const label = receiverHolders
      .map((r) => (r.trigram ? `${r.name} (${r.trigram})` : r.name))
      .join(', ');
    out.push({
      depot,
      receiverHolders,
      receiverNamesLabel: label,
      receiverLabel: label,
    });
  }

  return out;
}

/**
 * Vérifie si l'utilisateur peut valider la réception d'un transfert donné.
 * Note : séparation des tâches — l'expéditeur ne peut pas valider lui-même la réception (sauf rôles 0/1).
 */
export function canUserReceiveTransfer(
  transfer: StockTransferRecord,
  user: User | null | undefined,
  depots: Depot[],
  holders: DepotHolder[],
  hasReceiveAllPerm: boolean
): boolean {
  if (!user || user.is_blocked) return false;
  if (transfer.status !== 'IN_TRANSIT') return false;
  const isAdmin = Number(user.id) === 0 || Number(user.role_id) === 0 || Number(user.role_id) === 1;
  const userIdStr = String(user.id);
  if (String(transfer.sender_id) === userIdStr && !isAdmin) {
    return false;
  }
  if (isAdmin || hasReceiveAllPerm) {
    return true;
  }
  const destDepot = depots.find(
    (d) =>
      normalizeDepotKey(d.id) === normalizeDepotKey(transfer.dest_depot_id) ||
      normalizeDepotKey(d.name) === normalizeDepotKey(transfer.dest_depot)
  );
  return holders.some((h) => {
    if (String(h.user_id) !== userIdStr || !h.can_receive) return false;
    if (destDepot && doesHolderMatchDepot(h, destDepot)) return true;
    return (
      normalizeDepotKey(h.depot_id) === normalizeDepotKey(transfer.dest_depot_id) ||
      normalizeDepotKey(h.depot_id) === normalizeDepotKey(transfer.dest_depot)
    );
  });
}

/**
 * Vérifie si l'utilisateur peut confirmer ou contester un écart de réception (statut AWAITING_SENDER).
 * Séparation des tâches : jamais par le receveur qui a modifié la quantité (sauf rôles 0/1).
 */
export function canUserConfirmTransferAdjustment(
  transfer: StockTransferRecord,
  user: User | null | undefined,
  depots: Depot[],
  holders: DepotHolder[]
): boolean {
  if (!user || user.is_blocked) return false;
  if (transfer.status !== 'AWAITING_SENDER') return false;
  const isAdmin = Number(user.id) === 0 || Number(user.role_id) === 0 || Number(user.role_id) === 1;
  const userIdStr = String(user.id);
  if (transfer.receiver_id && String(transfer.receiver_id) === userIdStr && !isAdmin) {
    return false;
  }
  if (isAdmin || String(transfer.sender_id) === userIdStr) {
    return true;
  }
  const srcDepot = depots.find(
    (d) =>
      normalizeDepotKey(d.id) === normalizeDepotKey(transfer.source_depot_id) ||
      normalizeDepotKey(d.name) === normalizeDepotKey(transfer.source_depot)
  );
  return holders.some((h) => {
    if (String(h.user_id) !== userIdStr || !h.can_send) return false;
    if (srcDepot && doesHolderMatchDepot(h, srcDepot)) return true;
    return (
      normalizeDepotKey(h.depot_id) === normalizeDepotKey(transfer.source_depot_id) ||
      normalizeDepotKey(h.depot_id) === normalizeDepotKey(transfer.source_depot)
    );
  });
}

export function canUserCancelTransfer(
  transfer: StockTransferRecord,
  user: User | null | undefined,
  depots: Depot[],
  holders: DepotHolder[]
): boolean {
  if (!user || user.is_blocked) return false;
  if (transfer.status !== 'IN_TRANSIT') return false;
  const isAdmin = Number(user.id) === 0 || Number(user.role_id) === 0 || Number(user.role_id) === 1;
  const userIdStr = String(user.id);
  if (isAdmin || String(transfer.sender_id) === userIdStr) return true;
  const srcDepot = depots.find(
    (d) =>
      normalizeDepotKey(d.id) === normalizeDepotKey(transfer.source_depot_id) ||
      normalizeDepotKey(d.name) === normalizeDepotKey(transfer.source_depot)
  );
  return holders.some((h) => {
    if (String(h.user_id) !== userIdStr || !h.can_send) return false;
    if (srcDepot && doesHolderMatchDepot(h, srcDepot)) return true;
    return (
      normalizeDepotKey(h.depot_id) === normalizeDepotKey(transfer.source_depot_id) ||
      normalizeDepotKey(h.depot_id) === normalizeDepotKey(transfer.source_depot)
    );
  });
}

export function canUserResolveTransferDispute(
  user: User | null | undefined,
  hasReceiveAllPerm: boolean
): boolean {
  if (!user || user.is_blocked) return false;
  return (
    Number(user.id) === 0 ||
    Number(user.role_id) === 0 ||
    Number(user.role_id) === 1 ||
    hasReceiveAllPerm
  );
}

export function isTransferOverdue(
  transfer: Pick<StockTransferRecord, 'status' | 'created_at'>,
  hoursThreshold = 48,
  nowMs = Date.now()
): boolean {
  if (!['IN_TRANSIT', 'AWAITING_SENDER', 'DISPUTED'].includes(transfer.status)) {
    return false;
  }
  const createdMs = new Date(transfer.created_at).getTime();
  if (!Number.isFinite(createdMs)) return false;
  return nowMs - createdMs >= hoursThreshold * 3600 * 1000;
}

/**
 * Calcule le badge de l'entrée « Transferts » :
 * nombre de transferts IN_TRANSIT à recevoir par l'utilisateur
 * (+ AWAITING_SENDER à confirmer par l'expéditeur / responsable source).
 */
export function computeTransferBadgeCounts(
  transfers: StockTransferRecord[],
  user: User | null | undefined,
  depots: Depot[],
  holders: DepotHolder[],
  hasReceiveAllPerm: boolean
): {
  toReceiveCount: number;
  toConfirmCount: number;
  disputedCount: number;
  totalBadgeCount: number;
  totalBadge: number;
} {
  if (!user || user.is_blocked) {
    return {
      toReceiveCount: 0,
      toConfirmCount: 0,
      disputedCount: 0,
      totalBadgeCount: 0,
      totalBadge: 0,
    };
  }
  const toReceiveCount = transfers.filter((t) =>
    canUserReceiveTransfer(t, user, depots, holders, hasReceiveAllPerm)
  ).length;
  const toConfirmCount = transfers.filter((t) =>
    canUserConfirmTransferAdjustment(t, user, depots, holders)
  ).length;
  const canDispute = canUserResolveTransferDispute(user, hasReceiveAllPerm);
  const disputedCount = canDispute
    ? transfers.filter((t) => t.status === 'DISPUTED').length
    : 0;
  const total = toReceiveCount + toConfirmCount + disputedCount;

  return {
    toReceiveCount,
    toConfirmCount,
    disputedCount,
    totalBadgeCount: total,
    totalBadge: total,
  };
}

export function buildReceiveTransferItemsPayload(
  draftList: ReceiveLineDraft[]
): ReceiveTransferItemOverride[];
export function buildReceiveTransferItemsPayload(
  lines: StockTransferLine[],
  drafts: Record<string, ReceiveLineDraft>
): {
  valid: boolean;
  error?: string;
  itemsPayload: ReceiveTransferItemOverride[];
  acceptedCount: number;
  modifiedCount: number;
  refusedCount: number;
  predictedStatus: StockTransferStatus;
};
export function buildReceiveTransferItemsPayload(
  linesOrDrafts: StockTransferLine[] | ReceiveLineDraft[],
  draftsOptional?: Record<string, ReceiveLineDraft>
):
  | ReceiveTransferItemOverride[]
  | {
      valid: boolean;
      error?: string;
      itemsPayload: ReceiveTransferItemOverride[];
      acceptedCount: number;
      modifiedCount: number;
      refusedCount: number;
      predictedStatus: StockTransferStatus;
    } {
  // Appel à 1 argument : `buildReceiveTransferItemsPayload(draftList)` -> retourne directement `ReceiveTransferItemOverride[]`
  if (draftsOptional === undefined) {
    const draftList = (linesOrDrafts as ReceiveLineDraft[]) || [];
    const overrides: ReceiveTransferItemOverride[] = [];
    for (const d of draftList) {
      const pid = String(d.product_id ?? d.productId ?? '').trim();
      if (!pid || d.mode === 'ACCEPT') continue;
      const reason = String(d.reason ?? d.comment ?? '').trim();
      const qtySent = Number(d.quantitySent ?? 0);
      const qtyRec = Number(d.quantity_received ?? d.quantityReceived ?? 0);
      if (d.mode === 'REFUSE') {
        overrides.push({
          product_id: pid,
          accepted: false,
          quantity_received: 0,
          reason: reason || undefined,
        });
      } else if (d.mode === 'MODIFY') {
        if (qtySent > 0 && qtyRec === qtySent) continue;
        overrides.push({
          product_id: pid,
          accepted: true,
          quantity_received: qtyRec,
          reason: reason || undefined,
        });
      }
    }
    return overrides;
  }

  const lines = (linesOrDrafts as StockTransferLine[]) || [];
  const drafts = draftsOptional || {};
  const itemsPayload: ReceiveTransferItemOverride[] = [];
  let acceptedCount = 0;
  let modifiedCount = 0;
  let refusedCount = 0;

  for (const line of lines) {
    const pid = String(line.product_id);
    const qtySent = Number(line.quantity_sent ?? line.quantity ?? 0);
    const draft = drafts[pid];

    if (!draft || draft.mode === 'ACCEPT') {
      acceptedCount += 1;
      continue;
    }

    const reason = String(draft.reason ?? draft.comment ?? '').trim();

    if (draft.mode === 'REFUSE') {
      if (!reason) {
        return {
          valid: false,
          error: `Un motif est obligatoire pour refuser l'article « ${line.product_ref || pid} ».`,
          itemsPayload: [],
          acceptedCount: 0,
          modifiedCount: 0,
          refusedCount: 0,
          predictedStatus: 'IN_TRANSIT',
        };
      }
      refusedCount += 1;
      itemsPayload.push({
        product_id: pid,
        accepted: false,
        quantity_received: 0,
        reason,
      });
      continue;
    }

    if (draft.mode === 'MODIFY') {
      const qtyRec = Number(draft.quantity_received ?? draft.quantityReceived);
      if (!Number.isFinite(qtyRec) || qtyRec < 1) {
        return {
          valid: false,
          error: `La quantité reçue pour « ${line.product_ref || pid} » doit être au moins 1 (utilisez « Refuser » pour 0).`,
          itemsPayload: [],
          acceptedCount: 0,
          modifiedCount: 0,
          refusedCount: 0,
          predictedStatus: 'IN_TRANSIT',
        };
      }
      if (qtyRec > qtySent) {
        return {
          valid: false,
          error: `Surplus interdit pour « ${line.product_ref || pid} » (envoyé : ${qtySent}, saisi : ${qtyRec}).`,
          itemsPayload: [],
          acceptedCount: 0,
          modifiedCount: 0,
          refusedCount: 0,
          predictedStatus: 'IN_TRANSIT',
        };
      }
      if (qtyRec === qtySent) {
        acceptedCount += 1;
        continue;
      }
      if (!reason) {
        return {
          valid: false,
          error: `Un commentaire est obligatoire lorsque la quantité reçue est modifiée pour « ${line.product_ref || pid} ».`,
          itemsPayload: [],
          acceptedCount: 0,
          modifiedCount: 0,
          refusedCount: 0,
          predictedStatus: 'IN_TRANSIT',
        };
      }
      modifiedCount += 1;
      itemsPayload.push({
        product_id: pid,
        accepted: true,
        quantity_received: qtyRec,
        reason,
      });
    }
  }

  let predictedStatus: StockTransferStatus = 'RECEIVED';
  if (modifiedCount > 0) {
    predictedStatus = 'AWAITING_SENDER';
  } else if (refusedCount === lines.length && lines.length > 0) {
    predictedStatus = 'REJECTED';
  } else if (refusedCount > 0) {
    predictedStatus = 'PARTIALLY_RECEIVED';
  }

  return {
    valid: true,
    itemsPayload,
    acceptedCount,
    modifiedCount,
    refusedCount,
    predictedStatus,
  };
}

/**
 * Calcule la quantité totale en transit (statut IN_TRANSIT) pour un article donné.
 */
export function computeProductInTransitQty(
  productId: string,
  transfers: StockTransferRecord[],
  depotFilter?: string
): number {
  const pid = String(productId || '').trim();
  if (!pid) return 0;
  const cleanDepot = depotFilter && depotFilter !== 'ALL' ? normalizeDepotKey(depotFilter) : '';
  let sum = 0;

  for (const trf of transfers) {
    if (trf.status !== 'IN_TRANSIT') continue;
    if (
      cleanDepot &&
      normalizeDepotKey(trf.source_depot) !== cleanDepot &&
      normalizeDepotKey(trf.dest_depot) !== cleanDepot
    ) {
      continue;
    }
    for (const item of trf.items || []) {
      if (String(item.product_id) === pid) {
        sum += Number(item.quantity_sent ?? item.quantity ?? 0);
      }
    }
  }
  return sum;
}

export async function fetchDepotHoldersFromServer(clientOptional?: any): Promise<DepotHolder[]> {
  const client =
    clientOptional && typeof clientOptional.from === 'function'
      ? clientOptional
      : getClientSupabase();
  if (!client) return [];
  const { data, error } = await client
    .from('stk_depot_holders')
    .select('*')
    .order('depot_id', { ascending: true });
  if (error || !Array.isArray(data)) return [];
  return data.map((row: Record<string, unknown>) => ({
    depot_id: String(row.depot_id ?? ''),
    user_id: String(row.user_id ?? ''),
    can_send: Boolean(row.can_send),
    can_receive: Boolean(row.can_receive),
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
    updated_by: row.updated_by ? String(row.updated_by) : null,
  }));
}

export async function saveDepotHoldersRpc(
  clientOrDepotId: any,
  depotIdOrHolders: any,
  holdersOptional?: Array<{ user_id: string | number; can_send: boolean; can_receive: boolean }>
): Promise<{ success: boolean; error?: string }> {
  let client: any;
  let depotId: string | number;
  let holders: Array<{ user_id: string | number; can_send: boolean; can_receive: boolean }>;

  if (clientOrDepotId && typeof clientOrDepotId.rpc === 'function') {
    client = clientOrDepotId;
    depotId = depotIdOrHolders;
    holders = holdersOptional || [];
  } else {
    client = getClientSupabase();
    depotId = clientOrDepotId;
    holders = depotIdOrHolders || [];
  }

  if (!client) {
    return { success: true };
  }
  const { error } = await client.rpc('set_depot_holders', {
    p_depot_id: String(depotId),
    p_holders: holders.map((h) => ({
      user_id: String(h.user_id),
      can_send: Boolean(h.can_send),
      can_receive: Boolean(h.can_receive),
    })),
  });
  if (error) {
    return { success: false, error: error.message || 'Erreur lors de la sauvegarde des responsables.' };
  }
  return { success: true };
}

export function normalizeTransferRecord(row: Record<string, unknown>): StockTransferRecord {
  const rawItems = Array.isArray(row.items) ? row.items : [];
  const items: StockTransferLine[] = rawItems.map((it: Record<string, unknown>) => {
    const qtySent = Number(it.quantity_sent ?? it.quantity ?? 0);
    const qtyRec =
      it.quantity_received !== null && it.quantity_received !== undefined
        ? Number(it.quantity_received)
        : it.quantity_accepted !== null && it.quantity_accepted !== undefined
        ? Number(it.quantity_accepted)
        : null;
    const reason = it.receiver_reason
      ? String(it.receiver_reason)
      : it.receiver_comment
      ? String(it.receiver_comment)
      : null;

    return {
      product_id: String(it.product_id ?? ''),
      product_ref: String(it.product_ref ?? it.product_id ?? ''),
      product_name: it.product_name ? String(it.product_name) : undefined,
      unit_price: Number(it.unit_price ?? 0),
      quantity: qtySent,
      quantity_sent: qtySent,
      quantity_received: qtyRec,
      quantity_accepted: qtyRec,
      quantity_pending: Number(it.quantity_pending ?? 0),
      dest_rack: it.dest_rack ? String(it.dest_rack) : null,
      line_status: it.line_status ? String(it.line_status) : undefined,
      accepted:
        it.accepted !== null && it.accepted !== undefined ? Boolean(it.accepted) : null,
      receiver_reason: reason,
      receiver_comment: reason,
      sender_confirmed:
        it.sender_confirmed !== null && it.sender_confirmed !== undefined
          ? Boolean(it.sender_confirmed)
          : null,
      sender_comment: it.sender_comment ? String(it.sender_comment) : null,
      dispute_resolution: it.dispute_resolution ? String(it.dispute_resolution) : null,
      dispute_comment: it.dispute_comment ? String(it.dispute_comment) : null,
      movement_id: it.movement_id ? String(it.movement_id) : null,
    };
  });

  const totalPieces = Number(
    row.total_pieces ??
      row.total_quantity_sent ??
      items.reduce((acc, l) => acc + (Number(l.quantity_sent) || 0), 0)
  );
  const commentsHistory = Array.isArray(row.comments_history)
    ? (row.comments_history as StockTransferRecord['comments_history'])
    : Array.isArray(row.comments)
    ? (row.comments as StockTransferRecord['comments_history'])
    : [];

  return {
    id: String(row.id ?? row.transfer_number ?? ''),
    transfer_number: String(row.transfer_number ?? row.id ?? ''),
    batch_id: String(row.batch_id ?? ''),
    source_depot_id: row.source_depot_id ? String(row.source_depot_id) : null,
    source_depot: String(row.source_depot ?? ''),
    dest_depot_id: row.dest_depot_id ? String(row.dest_depot_id) : null,
    dest_depot: String(row.dest_depot ?? ''),
    status: (String(row.status || 'IN_TRANSIT') as StockTransferStatus) || 'IN_TRANSIT',
    items,
    reason: row.reason ? String(row.reason) : null,
    total_pieces: totalPieces,
    total_cost: Number(row.total_cost ?? 0),
    total_items: Number(row.total_items ?? items.length),
    total_quantity_sent: totalPieces,
    total_quantity_received: Number(row.total_quantity_received ?? 0),
    sender_id: String(row.sender_id ?? ''),
    sender_name: row.sender_name ? String(row.sender_name) : null,
    sender_trigram: row.sender_trigram ? String(row.sender_trigram) : null,
    receiver_id: row.receiver_id ? String(row.receiver_id) : null,
    receiver_name: row.receiver_name ? String(row.receiver_name) : null,
    receiver_note: row.receiver_note ? String(row.receiver_note) : null,
    sender_confirmed_by: row.sender_confirmed_by ? String(row.sender_confirmed_by) : null,
    sender_confirmed_by_name: row.sender_confirmed_by_name
      ? String(row.sender_confirmed_by_name)
      : null,
    sender_confirmed_at: row.sender_confirmed_at ? String(row.sender_confirmed_at) : null,
    sender_comment: row.sender_comment ? String(row.sender_comment) : null,
    resolved_by: row.resolved_by ? String(row.resolved_by) : null,
    resolved_by_name: row.resolved_by_name ? String(row.resolved_by_name) : null,
    resolved_at: row.resolved_at ? String(row.resolved_at) : null,
    resolution_action: row.resolution_action ? String(row.resolution_action) : null,
    resolution_note: row.resolution_note ? String(row.resolution_note) : null,
    comments: commentsHistory,
    comments_history: commentsHistory,
    created_at: String(row.created_at ?? new Date().toISOString()),
    received_at: row.received_at ? String(row.received_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export async function fetchStockTransfersFromServer(
  clientOrLimit?: any,
  optionsOptional?: { limit?: number } | number
): Promise<StockTransferRecord[]> {
  let client: any;
  let limit = 200;

  if (clientOrLimit && typeof clientOrLimit.from === 'function') {
    client = clientOrLimit;
    if (typeof optionsOptional === 'number') {
      limit = optionsOptional;
    } else if (optionsOptional && typeof optionsOptional.limit === 'number') {
      limit = optionsOptional.limit;
    }
  } else {
    client = getClientSupabase();
    if (typeof clientOrLimit === 'number') {
      limit = clientOrLimit;
    }
  }

  if (!client) return [];
  const { data, error } = await client
    .from('stk_transfers')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !Array.isArray(data)) return [];
  return data.map((row: Record<string, unknown>) => normalizeTransferRecord(row));
}

export async function receiveStockTransferRpc(
  clientOrTransferId: any,
  itemsOrParams:
    | ReceiveTransferItemOverride[]
    | {
        transferId: string;
        items: ReceiveTransferItemOverride[];
        note?: string | null;
      },
  noteOptional?: string | null
): Promise<{ success: boolean; status?: StockTransferStatus; error?: string }> {
  let client: any;
  let transferId: string;
  let itemsPayload: ReceiveTransferItemOverride[];
  let note: string | null | undefined;

  if (clientOrTransferId && typeof clientOrTransferId.rpc === 'function') {
    client = clientOrTransferId;
    const p = itemsOrParams as {
      transferId: string;
      items: ReceiveTransferItemOverride[];
      note?: string | null;
    };
    transferId = p.transferId;
    itemsPayload = p.items || [];
    note = p.note;
  } else {
    client = getClientSupabase();
    transferId = String(clientOrTransferId);
    itemsPayload = (itemsOrParams as ReceiveTransferItemOverride[]) || [];
    note = noteOptional;
  }

  if (!client) {
    return { success: true, status: 'RECEIVED' };
  }
  const { data, error } = await client.rpc('receive_stock_transfer', {
    p_transfer_id: transferId,
    p_items: itemsPayload,
    p_note: note?.trim() || null,
  });
  if (error) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la validation de la réception.',
    };
  }
  const resObj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    success: true,
    status: (resObj.status as StockTransferStatus) || 'RECEIVED',
  };
}

export async function rejectStockTransferRpc(
  clientOrTransferId: any,
  noteOrParams: string | { transferId: string; reason?: string; note?: string }
): Promise<{ success: boolean; error?: string }> {
  let client: any;
  let transferId: string;
  let rawNote: string;

  if (clientOrTransferId && typeof clientOrTransferId.rpc === 'function') {
    client = clientOrTransferId;
    const p = noteOrParams as { transferId: string; reason?: string; note?: string };
    transferId = p.transferId;
    rawNote = String(p.reason ?? p.note ?? '');
  } else {
    client = getClientSupabase();
    transferId = String(clientOrTransferId);
    rawNote = String(noteOrParams ?? '');
  }

  const cleanNote = rawNote.trim();
  if (!cleanNote) {
    return {
      success: false,
      error: 'Un motif est obligatoire pour refuser un transfert en bloc.',
    };
  }
  if (!client) {
    return { success: true };
  }
  const { error } = await client.rpc('reject_stock_transfer', {
    p_transfer_id: transferId,
    p_note: cleanNote,
  });
  if (error) {
    return { success: false, error: error.message || 'Erreur lors du refus du transfert.' };
  }
  return { success: true };
}

export async function cancelStockTransferRpc(
  clientOrTransferId: any,
  noteOrParams?: string | null | { transferId: string; reason?: string; note?: string }
): Promise<{ success: boolean; error?: string }> {
  let client: any;
  let transferId: string;
  let note: string | null | undefined;

  if (clientOrTransferId && typeof clientOrTransferId.rpc === 'function') {
    client = clientOrTransferId;
    const p = (noteOrParams || {}) as { transferId: string; reason?: string; note?: string };
    transferId = p.transferId;
    note = p.reason ?? p.note;
  } else {
    client = getClientSupabase();
    transferId = String(clientOrTransferId);
    note = typeof noteOrParams === 'string' ? noteOrParams : null;
  }

  if (!client) {
    return { success: true };
  }
  const { error } = await client.rpc('cancel_stock_transfer', {
    p_transfer_id: transferId,
    p_note: note?.trim() || null,
  });
  if (error) {
    return { success: false, error: error.message || 'Erreur lors de l’annulation du transfert.' };
  }
  return { success: true };
}

export async function confirmStockTransferAdjustmentRpc(
  clientOrTransferId: any,
  confirmOrParams:
    | boolean
    | { transferId: string; accept?: boolean; confirm?: boolean; comment?: string | null },
  commentOptional?: string | null
): Promise<{ success: boolean; status?: StockTransferStatus; error?: string }> {
  let client: any;
  let transferId: string;
  let confirm: boolean;
  let comment: string | null | undefined;

  if (clientOrTransferId && typeof clientOrTransferId.rpc === 'function') {
    client = clientOrTransferId;
    const p = confirmOrParams as {
      transferId: string;
      accept?: boolean;
      confirm?: boolean;
      comment?: string | null;
    };
    transferId = p.transferId;
    confirm = Boolean(p.confirm ?? p.accept);
    comment = p.comment;
  } else {
    client = getClientSupabase();
    transferId = String(clientOrTransferId);
    confirm = Boolean(confirmOrParams);
    comment = commentOptional;
  }

  const cleanComment = String(comment || '').trim();
  if (!confirm && !cleanComment) {
    return {
      success: false,
      error: "Un commentaire est obligatoire pour contester l'écart de réception.",
    };
  }
  if (!client) {
    return { success: true, status: confirm ? 'PARTIALLY_RECEIVED' : 'DISPUTED' };
  }
  const { data, error } = await client.rpc('confirm_stock_transfer_adjustment', {
    p_transfer_id: transferId,
    p_confirm: confirm,
    p_comment: cleanComment || null,
  });
  if (error) {
    return {
      success: false,
      error: error.message || "Erreur lors de la confirmation/contestation de l'écart.",
    };
  }
  const resObj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    success: true,
    status:
      (resObj.status as StockTransferStatus) || (confirm ? 'PARTIALLY_RECEIVED' : 'DISPUTED'),
  };
}

export async function resolveTransferDisputeRpc(
  clientOrTransferId: any,
  actionOrParams:
    | 'RETURN_TO_SOURCE'
    | 'WRITE_OFF'
    | {
        transferId: string;
        action?: 'RETURN_TO_SOURCE' | 'WRITE_OFF';
        resolutions?: Array<{ product_id: string; quantity_accepted: number }>;
        note?: string;
        comment?: string;
      },
  commentOptional?: string
): Promise<{ success: boolean; error?: string }> {
  let client: any;
  let transferId: string;
  let action: 'RETURN_TO_SOURCE' | 'WRITE_OFF' = 'RETURN_TO_SOURCE';
  let rawComment = '';

  if (clientOrTransferId && typeof clientOrTransferId.rpc === 'function') {
    client = clientOrTransferId;
    const p = actionOrParams as {
      transferId: string;
      action?: 'RETURN_TO_SOURCE' | 'WRITE_OFF';
      resolutions?: Array<{ product_id: string; quantity_accepted: number }>;
      note?: string;
      comment?: string;
    };
    transferId = p.transferId;
    if (p.action) {
      action = p.action;
    } else if (Array.isArray(p.resolutions) && p.resolutions.some((r) => r.quantity_accepted === 0)) {
      action = 'WRITE_OFF';
    }
    rawComment = String(p.comment ?? p.note ?? '');
  } else {
    client = getClientSupabase();
    transferId = String(clientOrTransferId);
    action = (actionOrParams as 'RETURN_TO_SOURCE' | 'WRITE_OFF') || 'RETURN_TO_SOURCE';
    rawComment = String(commentOptional ?? '');
  }

  const cleanComment = rawComment.trim();
  if (!cleanComment) {
    return {
      success: false,
      error: "Un commentaire d'arbitrage est obligatoire pour résoudre un litige.",
    };
  }
  if (!client) {
    return { success: true };
  }
  const { error } = await client.rpc('resolve_transfer_dispute', {
    p_transfer_id: transferId,
    p_action: action,
    p_comment: cleanComment,
  });
  if (error) {
    return {
      success: false,
      error: error.message || "Erreur lors de l'arbitrage du litige.",
    };
  }
  return { success: true };
}

export async function fetchOverdueTransfersRpc(
  clientOrHours?: any,
  hoursOptional?: number
): Promise<StockTransferRecord[]> {
  let client: any;
  let hours = 48;

  if (clientOrHours && typeof clientOrHours.rpc === 'function') {
    client = clientOrHours;
    if (typeof hoursOptional === 'number') {
      hours = hoursOptional;
    }
  } else {
    client = getClientSupabase();
    if (typeof clientOrHours === 'number') {
      hours = clientOrHours;
    }
  }

  if (!client) return [];
  const { data, error } = await client.rpc('list_overdue_transfers', { p_hours: hours });
  if (error || !Array.isArray(data)) return [];
  return data.map((row: Record<string, unknown>) => normalizeTransferRecord(row));
}

export function canViewStockLevelsReport(
  user: User | null | undefined,
  hasReportStockLevelsPerm: boolean
): boolean {
  if (!user || user.is_blocked) return false;
  if (Number(user.id) === 0 || Number(user.role_id) === 0 || Number(user.role_id) === 1) {
    return true;
  }
  return Boolean(hasReportStockLevelsPerm);
}

export function mapStockLevelsReportRowsToProducts(
  rows: StockLevelsReportRow[],
  catalogProducts: Array<{ id?: string; reference?: string; supplier_1_name?: string }> = []
): Array<{
  id: string;
  reference: string;
  brand: string;
  model: string;
  sub_category_id: number;
  store_name: string;
  shelf_name: string;
  quantity: number;
  min_stock_alert: number;
  unit_price: number;
  supplier_1_name?: string;
}> {
  const byId = new Map<string, { supplier_1_name?: string }>();
  const byRef = new Map<string, { supplier_1_name?: string }>();
  for (const p of catalogProducts) {
    if (p.id) byId.set(String(p.id), p);
    if (p.reference) byRef.set(String(p.reference), p);
  }
  return rows.map((r) => {
    const match = byId.get(String(r.product_id)) || byRef.get(String(r.reference));
    return {
      id: r.product_id,
      reference: r.reference,
      brand: r.brand,
      model: r.model,
      sub_category_id: r.sub_category_id ?? 1,
      store_name: r.depot_name,
      shelf_name: r.rack_location,
      quantity: r.quantity,
      min_stock_alert: r.min_stock_alert,
      unit_price: r.unit_price,
      supplier_1_name: match?.supplier_1_name,
    };
  });
}

export async function fetchStockLevelsReportRpc(params: {
  depot?: string | null;
  onlyLow?: boolean;
}): Promise<{ data: StockLevelsReportRow[]; error?: string }> {
  const client = getClientSupabase();
  if (!client) {
    return { data: [] };
  }
  const { data, error } = await client.rpc('get_stock_levels_report', {
    p_depot: params.depot && params.depot !== 'ALL' ? params.depot : null,
    p_only_low: Boolean(params.onlyLow),
  });
  if (error) {
    return { data: [], error: error.message || 'Erreur lors du chargement du rapport de stock.' };
  }
  const rows: StockLevelsReportRow[] = Array.isArray(data)
    ? data.map((r: Record<string, unknown>) => ({
        product_id: String(r.product_id ?? ''),
        reference: String(r.reference ?? ''),
        brand: String(r.brand ?? ''),
        model: String(r.model ?? ''),
        sub_category_id:
          r.sub_category_id !== null && r.sub_category_id !== undefined
            ? Number(r.sub_category_id)
            : null,
        depot_name: String(r.depot_name ?? 'Dépôt Principal'),
        rack_location: String(r.rack_location ?? ''),
        quantity: Number(r.quantity ?? 0),
        min_stock_alert: Number(r.min_stock_alert ?? 0),
        unit_price: Number(r.unit_price ?? 0),
        total_value: Number(r.total_value ?? 0),
        in_transit_qty: Number(r.in_transit_qty ?? 0),
        is_low_stock: Boolean(r.is_low_stock),
        is_out_of_stock: Boolean(r.is_out_of_stock),
      }))
    : [];
  return { data: rows };
}
