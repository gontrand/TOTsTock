import { MaterialOrder } from '../types';

export const ORDER_AUDIT_CATEGORY = 'ORDERS' as const;

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
}

export function buildOrderTraceabilityDetails(
  order?: Partial<MaterialOrder> | null,
  lang: 'fr' | 'en' | 'nl' = 'fr'
): OrderTraceabilityDetails {
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
  const note =
    (safeOrder.pickup_delegate_notes && String(safeOrder.pickup_delegate_notes).trim()) ||
    (safeOrder.pickup_delegation_note && String(safeOrder.pickup_delegation_note).trim()) ||
    undefined;

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
    collectedAtFormatted: formatTraceabilityDateTime(collectedAt, lang),
    pickupTransferred: isOrderPickupTransferred(order),
    pickupTransferSummary: formatOrderPickupTransferSummary(order, lang),
    pickupDelegationNote: note,
    pickupDelegateNotes: note,
  };
}
