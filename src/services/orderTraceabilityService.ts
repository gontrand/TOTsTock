import { Department, MaterialOrder, Project, User } from '../types';

export const ORDER_AUDIT_CATEGORY = 'ORDERS' as const;

export const ORDER_PICKUP_QR_UNAUTHORIZED_MESSAGE =
  'Seul le demandeur ou son délégué peut valider ce retrait';

function sameEntityId(a?: string | number | null, b?: string | number | null): boolean {
  if (a === undefined || a === null || b === undefined || b === null) return false;
  const sa = String(a).trim();
  const sb = String(b).trim();
  return sa.length > 0 && sa === sb;
}

/**
 * Règle v60 §8.1 :
 * Le passage d'une commande à `COLLECTED` n'est possible QUE pour le DEMANDEUR (`requester_id`)
 * ou le DÉLÉGUÉ de retrait (`pickup_delegate_id`), et uniquement si la commande est `READY`.
 * Les préparateurs, responsables et administrateurs ne peuvent PAS valider un retrait à la place du demandeur/délégué.
 */
export function canUserValidateOrderPickup(
  user?: Partial<User> | null,
  order?: Partial<Pick<MaterialOrder, 'status' | 'requester_id' | 'pickup_delegate_id'>> | null
): boolean {
  if (!user || user.id === undefined || user.id === null || !order) return false;
  if (order.status !== 'READY') return false;
  if (sameEntityId(user.id, order.requester_id)) return true;
  if (
    order.pickup_delegate_id !== undefined &&
    order.pickup_delegate_id !== null &&
    String(order.pickup_delegate_id).trim() !== '' &&
    sameEntityId(user.id, order.pickup_delegate_id)
  ) {
    return true;
  }
  return false;
}

/**
 * Message affiché à la place du bouton « Valider le retrait » pour tout utilisateur
 * qui n'est ni le demandeur ni le délégué de retrait (v60 §8.1).
 */
export function getOrderPickupReservedMessage(
  order?: Partial<Pick<MaterialOrder, 'requester_name' | 'pickup_delegate_name'>> | null,
  lang: 'fr' | 'en' | 'nl' = 'fr'
): string {
  const reqName = (order?.requester_name || '').trim() || '—';
  const delName = (order?.pickup_delegate_name || '').trim();
  if (lang === 'en') {
    return delName
      ? `Pickup reserved for requester (${reqName}) or delegate (${delName})`
      : `Pickup reserved for requester (${reqName}) or delegate`;
  }
  if (lang === 'nl') {
    return delName
      ? `Afhaling voorbehouden aan aanvrager (${reqName}) of gemachtigde (${delName})`
      : `Afhaling voorbehouden aan aanvrager (${reqName}) of gemachtigde`;
  }
  return delName
    ? `Retrait réservé au demandeur (${reqName}) ou à son délégué (${delName})`
    : `Retrait réservé au demandeur (${reqName}) ou à son délégué`;
}

/**
 * Vérifie que la signature de retrait est présente et n'est pas un simple point ou canevas vide (v60 §8.3).
 */
export function isValidPickupSignature(
  signatureData?: string | null,
  strokePointsCount?: number
): boolean {
  if (!signatureData || typeof signatureData !== 'string') return false;
  const trimmed = signatureData.trim();
  if (!trimmed) return false;
  if (strokePointsCount !== undefined && strokePointsCount < 4) {
    return false;
  }
  if (trimmed.startsWith('data:image/')) {
    const commaIdx = trimmed.indexOf(',');
    if (commaIdx === -1) return false;
    const base64Payload = trimmed.slice(commaIdx + 1).trim();
    // Un tracé réel non vide produit une charge utile substantielle (pas un simple point)
    return base64Payload.length >= 48;
  }
  return trimmed.length >= 24;
}

/**
 * Détermine si `user` a le droit de consulter l'image de la signature d'une commande retirée (v60 §8.8) :
 * - le demandeur (`requester_id`)
 * - le délégué de retrait (`pickup_delegate_id`)
 * - le préparateur de la commande (`preparer_id`)
 * - le responsable du département (et suppléants) du demandeur
 * - le gestionnaire du projet (et suppléants)
 * - les administrateurs (rôles 0 et 1)
 * Les autres utilisateurs voient seulement « Retrait signé » sans l'image.
 */
export function canUserViewOrderSignature(
  userOrParams?:
    | Partial<User>
    | null
    | {
        user?: Partial<User> | null;
        order?: Partial<MaterialOrder> | null;
        departments?: Department[];
        projects?: Project[];
        users?: User[];
      },
  maybeOrder?: Partial<MaterialOrder> | null,
  maybeDepartments?: Department[],
  maybeProjects?: Project[],
  maybeUsers?: User[]
): boolean {
  const isParamsObj =
    userOrParams !== null &&
    typeof userOrParams === 'object' &&
    ('user' in userOrParams || 'order' in userOrParams) &&
    maybeOrder === undefined;

  const user = isParamsObj
    ? (userOrParams as { user?: Partial<User> | null }).user
    : (userOrParams as Partial<User> | null | undefined);
  const order = isParamsObj
    ? (userOrParams as { order?: Partial<MaterialOrder> | null }).order
    : maybeOrder;
  const departments =
    (isParamsObj
      ? (userOrParams as { departments?: Department[] }).departments
      : maybeDepartments) || [];
  const projects =
    (isParamsObj ? (userOrParams as { projects?: Project[] }).projects : maybeProjects) || [];
  const users =
    (isParamsObj ? (userOrParams as { users?: User[] }).users : maybeUsers) || [];

  if (!user || user.id === undefined || user.id === null || !order) return false;

  const roleIdNum = Number(user.role_id);
  if (roleIdNum === 0 || roleIdNum === 1 || Number(user.id) === 0) {
    return true;
  }

  if (
    sameEntityId(user.id, order.requester_id) ||
    sameEntityId(user.id, order.pickup_delegate_id) ||
    sameEntityId(user.id, order.preparer_id)
  ) {
    return true;
  }

  // Responsable du département (et suppléants) du demandeur
  const requesterUser = users.find((u) => sameEntityId(u.id, order.requester_id));
  const reqDeptName = String(
    order.requester_department || requesterUser?.department || ''
  )
    .trim()
    .toLowerCase();

  if (reqDeptName) {
    for (const dept of departments) {
      if (
        String(dept.id).toLowerCase() === reqDeptName ||
        (dept.name || '').trim().toLowerCase() === reqDeptName
      ) {
        if (sameEntityId(dept.manager_id, user.id)) return true;
        if (
          Array.isArray(dept.deputy_manager_ids) &&
          dept.deputy_manager_ids.some((id) => sameEntityId(id, user.id))
        ) {
          return true;
        }
      }
    }
  }

  // Gestionnaire du projet (et suppléants) + responsable du département du projet
  const siteNum = String(order.site_number || '').trim().toUpperCase();
  if (siteNum) {
    const proj = projects.find(
      (p) => String(p.project_number || '').trim().toUpperCase() === siteNum
    );
    if (proj) {
      if (sameEntityId(proj.manager_id, user.id)) return true;
      if (
        Array.isArray(proj.deputy_manager_ids) &&
        proj.deputy_manager_ids.some((id) => sameEntityId(id, user.id))
      ) {
        return true;
      }
      const projDept = departments.find((d) => Number(d.id) === Number(proj.department_id));
      if (projDept) {
        if (sameEntityId(projDept.manager_id, user.id)) return true;
        if (
          Array.isArray(projDept.deputy_manager_ids) &&
          projDept.deputy_manager_ids.some((id) => sameEntityId(id, user.id))
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

export const ORDER_AUDIT_EVENT_TYPES = [
  'ORDER_CREATED',
  'ORDER_ASSIGNED',
  'ORDER_READY',
  'ORDER_PICKUP_DELEGATED',
  'ORDER_COLLECTED',
  'ORDER_REJECTED',
  'ORDER_CANCELLED',
] as const;

export type OrderAuditEventType = (typeof ORDER_AUDIT_EVENT_TYPES)[number];

const ORDER_AUDIT_EVENT_LABELS: Record<
  OrderAuditEventType,
  { fr: string; en: string; nl: string }
> = {
  ORDER_CREATED: {
    fr: 'Commande créée',
    en: 'Order created',
    nl: 'Bestelling aangemaakt',
  },
  ORDER_ASSIGNED: {
    fr: 'Commande assignée au préparateur',
    en: 'Order assigned to preparer',
    nl: 'Bestelling toegewezen aan orderpicker',
  },
  ORDER_READY: {
    fr: 'Commande prête au retrait',
    en: 'Order ready for pickup',
    nl: 'Bestelling klaar voor afhaling',
  },
  ORDER_PICKUP_DELEGATED: {
    fr: 'Retrait transféré à un collègue',
    en: 'Pickup delegated to a colleague',
    nl: 'Afhaling overgedragen aan collega',
  },
  ORDER_COLLECTED: {
    fr: 'Commande retirée',
    en: 'Order collected',
    nl: 'Bestelling afgehaald',
  },
  ORDER_REJECTED: {
    fr: 'Commande refusée',
    en: 'Order rejected',
    nl: 'Bestelling geweigerd',
  },
  ORDER_CANCELLED: {
    fr: 'Commande annulée',
    en: 'Order cancelled',
    nl: 'Bestelling geannuleerd',
  },
};

export function isOrderAuditEventType(type?: string | null): type is OrderAuditEventType {
  if (!type) return false;
  return (ORDER_AUDIT_EVENT_TYPES as readonly string[]).includes(String(type).trim().toUpperCase());
}

export function getOrderAuditEventLabel(
  type: string,
  lang: 'fr' | 'en' | 'nl' = 'fr'
): string {
  const key = String(type || '').trim().toUpperCase() as OrderAuditEventType;
  const entry = ORDER_AUDIT_EVENT_LABELS[key];
  if (!entry) return type || '—';
  return entry[lang] || entry.fr;
}

export function formatTraceabilityDateTime(
  iso?: string | null,
  lang: 'fr' | 'en' | 'nl' = 'fr'
): string {
  if (!iso) return '—';
  const cleaned = String(iso).trim();
  if (!cleaned) return '—';
  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) return cleaned;
  const locale = lang === 'en' ? 'en-GB' : lang === 'nl' ? 'nl-NL' : 'fr-FR';
  const datePart = d.toLocaleDateString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timePart = d.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${datePart} ${timePart}`;
}

export function isOrderPickupTransferred(
  order?: Partial<MaterialOrder> | null
): boolean {
  if (!order) return false;
  const anyOrd = order as Record<string, any>;
  return Boolean(
    (order.pickup_delegate_id !== undefined &&
      order.pickup_delegate_id !== null &&
      String(order.pickup_delegate_id).trim() !== '') ||
      (order.pickup_delegate_name && String(order.pickup_delegate_name).trim() !== '') ||
      (order.pickup_delegate_at && String(order.pickup_delegate_at).trim() !== '') ||
      (anyOrd.pickup_delegated_at && String(anyOrd.pickup_delegated_at).trim() !== '')
  );
}

/**
 * Formate le statut « Retrait transféré » d'une commande :
 * - FR : « Oui (de X à Y, le …) » (plus la note si présente) ou « Non »
 * - EN : « Yes (from X to Y, on …) » ou « No »
 * - NL : « Ja (van X naar Y, op …) » ou « Nee »
 */
export function formatOrderPickupTransferSummary(
  order?: Partial<MaterialOrder> | null,
  lang: 'fr' | 'en' | 'nl' = 'fr'
): string {
  if (!isOrderPickupTransferred(order) || !order) {
    return lang === 'en' ? 'No' : lang === 'nl' ? 'Nee' : 'Non';
  }

  const anyOrd = order as Record<string, any>;

  const fromName =
    (order.pickup_delegate_by && String(order.pickup_delegate_by).trim()) ||
    (anyOrd.pickup_delegated_by_name && String(anyOrd.pickup_delegated_by_name).trim()) ||
    (order.requester_name && String(order.requester_name).trim()) ||
    (order.requester_id !== undefined && order.requester_id !== null
      ? `#${order.requester_id}`
      : '—');

  const toName =
    (order.pickup_delegate_name && String(order.pickup_delegate_name).trim()) ||
    (order.pickup_delegate_id !== undefined && order.pickup_delegate_id !== null
      ? `#${order.pickup_delegate_id}`
      : '—');

  const rawDelegatedAt = order.pickup_delegate_at || anyOrd.pickup_delegated_at;
  const hasDate = Boolean(rawDelegatedAt && String(rawDelegatedAt).trim());
  const formattedDate = hasDate ? formatTraceabilityDateTime(rawDelegatedAt, lang) : '';

  const rawNote = order.pickup_delegate_notes || anyOrd.pickup_delegation_note;
  const note = rawNote && String(rawNote).trim() ? String(rawNote).trim() : '';

  if (lang === 'en') {
    const dateSegment = formattedDate ? `, on ${formattedDate}` : '';
    const noteSegment = note ? ` — Note: ${note}` : '';
    return `Yes (from ${fromName} to ${toName}${dateSegment})${noteSegment}`;
  }

  if (lang === 'nl') {
    const dateSegment = formattedDate ? `, op ${formattedDate}` : '';
    const noteSegment = note ? ` — Notitie: ${note}` : '';
    return `Ja (van ${fromName} naar ${toName}${dateSegment})${noteSegment}`;
  }

  const dateSegment = formattedDate ? `, le ${formattedDate}` : '';
  const noteSegment = note ? ` — Note : ${note}` : '';
  return `Oui (de ${fromName} à ${toName}${dateSegment})${noteSegment}`;
}

export interface OrderTraceabilityDetails {
  requesterName: string;
  requesterTrigram?: string;
  createdAt?: string;
  createdAtFormatted: string;
  preparerName: string;
  preparerTrigram?: string;
  assignedAt?: string;
  assignedAtFormatted: string;
  readyAt?: string;
  readyAtFormatted: string;
  collectorName: string;
  collectorId?: string | number;
  collectedAt?: string;
  collectedAtFormatted: string;
  pickupTransferred: boolean;
  pickupTransferSummary: string;
  pickupDelegationNote?: string;
  pickupDelegateNotes?: string;
  hasSignature: boolean;
  canViewSignature: boolean;
  signatureData?: string | null;
  signedByLabel: string;
}

export interface OrderTraceViewerContext {
  user?: Partial<User> | null;
  currentUser?: Partial<User> | null;
  departments?: Department[];
  projects?: Project[];
  users?: User[];
  lang?: 'fr' | 'en' | 'nl';
}

export function buildOrderTraceabilityDetails(
  order?: Partial<MaterialOrder> | null,
  langOrViewerContext: 'fr' | 'en' | 'nl' | OrderTraceViewerContext = 'fr',
  maybeViewerContext?: OrderTraceViewerContext
): OrderTraceabilityDetails {
  const isSecondArgContext =
    langOrViewerContext !== null && typeof langOrViewerContext === 'object';
  const viewerContext: OrderTraceViewerContext | undefined = isSecondArgContext
    ? (langOrViewerContext as OrderTraceViewerContext)
    : maybeViewerContext;
  const lang: 'fr' | 'en' | 'nl' = isSecondArgContext
    ? (langOrViewerContext as OrderTraceViewerContext).lang || 'fr'
    : (langOrViewerContext as 'fr' | 'en' | 'nl') || 'fr';

  const safeOrder = (order || {}) as Record<string, any>;
  const requesterName =
    (safeOrder.requester_name && String(safeOrder.requester_name).trim()) ||
    (safeOrder.requester_id !== undefined && safeOrder.requester_id !== null
      ? `#${safeOrder.requester_id}`
      : '—');

  const preparerName =
    (safeOrder.preparer_name && String(safeOrder.preparer_name).trim()) ||
    (safeOrder.preparer_id !== undefined && safeOrder.preparer_id !== null
      ? `#${safeOrder.preparer_id}`
      : '—');

  const rawCollectedBy = safeOrder.collected_by ?? safeOrder.collected_by_id;
  const collectorName =
    (safeOrder.collected_by_name && String(safeOrder.collected_by_name).trim()) ||
    (rawCollectedBy !== undefined && rawCollectedBy !== null && String(rawCollectedBy).trim() !== ''
      ? String(rawCollectedBy)
      : '—');

  const assignedAt = safeOrder.assigned_at ? String(safeOrder.assigned_at) : undefined;
  const readyAt = safeOrder.ready_at ? String(safeOrder.ready_at) : undefined;
  const collectedAt = safeOrder.collected_at ? String(safeOrder.collected_at) : undefined;
  const collectedAtFormatted = formatTraceabilityDateTime(collectedAt, lang);
  const note =
    (safeOrder.pickup_delegate_notes && String(safeOrder.pickup_delegate_notes).trim()) ||
    (safeOrder.pickup_delegation_note && String(safeOrder.pickup_delegation_note).trim()) ||
    undefined;

  const rawSig = typeof safeOrder.signature_data === 'string' ? safeOrder.signature_data.trim() : '';
  const hasSignature = rawSig.length > 0;
  const effectiveUser = viewerContext?.user ?? viewerContext?.currentUser;
  const canViewSignature = viewerContext
    ? canUserViewOrderSignature({
        user: effectiveUser,
        order,
        departments: viewerContext.departments,
        projects: viewerContext.projects,
        users: viewerContext.users,
      })
    : true;

  const signer = collectorName !== '—' ? collectorName : requesterName;
  const signedByLabel = hasSignature
    ? lang === 'en'
      ? `Signed by ${signer}${collectedAtFormatted !== '—' ? ` on ${collectedAtFormatted}` : ''}`
      : lang === 'nl'
      ? `Ondertekend door ${signer}${collectedAtFormatted !== '—' ? ` op ${collectedAtFormatted}` : ''}`
      : `Signé par ${signer}${collectedAtFormatted !== '—' ? ` le ${collectedAtFormatted}` : ''}`
    : '';

  return {
    requesterName,
    requesterTrigram: safeOrder.requester_trigram || undefined,
    createdAt: safeOrder.created_at || undefined,
    createdAtFormatted: formatTraceabilityDateTime(safeOrder.created_at, lang),
    preparerName,
    preparerTrigram: safeOrder.preparer_trigram || undefined,
    assignedAt,
    assignedAtFormatted: formatTraceabilityDateTime(assignedAt, lang),
    readyAt,
    readyAtFormatted: formatTraceabilityDateTime(readyAt, lang),
    collectorName,
    collectorId: rawCollectedBy,
    collectedAt,
    collectedAtFormatted,
    pickupTransferred: isOrderPickupTransferred(order),
    pickupTransferSummary: formatOrderPickupTransferSummary(order, lang),
    pickupDelegationNote: note,
    pickupDelegateNotes: note,
    hasSignature,
    canViewSignature,
    signatureData: hasSignature && canViewSignature ? rawSig : null,
    signedByLabel,
  };
}

