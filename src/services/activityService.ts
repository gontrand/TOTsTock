import { StockMovement, Product } from '../types';

export type ActivityCategory = 'ALL' | 'MOVEMENTS' | 'SCANS' | 'SYSTEM';

export type ActivityType =
  | 'STOCK_IN'
  | 'STOCK_OUT'
  | 'SCAN_FOUND'
  | 'SCAN_NOT_FOUND'
  | 'SCAN_CONFIG'
  | 'SCAN_INVENTORY'
  | 'PRODUCT_CREATED'
  | 'PRODUCT_UPDATED'
  | 'PRODUCT_DELETED'
  | 'INVENTORY_AUDIT'
  | 'DEPOT_UPDATED'
  | 'SYSTEM_SYNC'
  | 'ORDER_MODIFIED'
  | 'USER_ACTION';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  category: 'MOVEMENTS' | 'SCANS' | 'SYSTEM';
  timestamp: string; // ISO 8601 string
  title: string;
  description: string;
  badgeText?: string;
  user_name?: string;
  user_trigram?: string;
  product_id?: string;
  product_ref?: string;
  quantity_changed?: number;
  site_number?: string | null;
  depot_name?: string | null;
  meta?: {
    scannedCode?: string;
    scanFormat?: string; // 'QR_CODE' | 'EAN_13' | 'CODE_128' | 'MANUAL' | etc.
    scanMode?: string;
    previousQty?: number;
    newQty?: number;
    difference?: number;
    unitPrice?: number;
    totalCost?: number;
    status?: 'success' | 'warning' | 'info' | 'error';
    deviceInfo?: string;
    systemVersion?: string;
    reason?: string;
    details?: string;
  };
}

const STORAGE_KEY = 'tot_inv_activity_events_v2';

// Realistic initial seed events for scans & system updates
const INITIAL_SEED_EVENTS: ActivityItem[] = [
  {
    id: 'act-seed-scan-1',
    type: 'SCAN_FOUND',
    category: 'SCANS',
    timestamp: new Date(Date.now() - 1000 * 60 * 18).toISOString(), // 18 mins ago
    title: 'Scan QR Code Référence',
    description: 'Bâti-Support Duofix Sigma 12cm (REF-605) scanné avec succès',
    user_name: 'Jean Dupont',
    user_trigram: 'JDU',
    product_id: 'REF-605',
    product_ref: 'REF-605',
    depot_name: 'Dépôt Principal',
    meta: {
      scannedCode: 'REF-605',
      scanFormat: 'QR_CODE',
      scanMode: 'SEARCH',
      status: 'success',
      deviceInfo: 'Caméra Viseur Haute Définition',
    },
  },
  {
    id: 'act-seed-sys-1',
    type: 'INVENTORY_AUDIT',
    category: 'SYSTEM',
    timestamp: new Date(Date.now() - 1000 * 60 * 75).toISOString(), // 1h15 ago
    title: 'Comptage d\'Inventaire Régularisé',
    description: 'Rapprochement stock théorique vs stock physique scanné (4 écarts traités)',
    user_name: 'Administrateur Général',
    user_trigram: 'ADM',
    depot_name: 'Dépôt Principal',
    meta: {
      status: 'success',
      difference: 4,
      reason: 'Régularisation suite à inventaire tournant mensuel',
      systemVersion: 'v5.9.1',
    },
  },
  {
    id: 'act-seed-scan-2',
    type: 'SCAN_FOUND',
    category: 'SCANS',
    timestamp: new Date(Date.now() - 1000 * 60 * 190).toISOString(), // ~3h ago
    title: 'Scan Code-barres Fabricant 1D',
    description: 'Tube PVC Évacuation Ø100 (REF-201) scanné via EAN-13',
    user_name: 'Jean Dupont',
    user_trigram: 'JDU',
    product_id: 'REF-201',
    product_ref: 'REF-201',
    depot_name: 'Dépôt Principal',
    meta: {
      scannedCode: '3304561001402',
      scanFormat: 'EAN_13',
      scanMode: 'OUT',
      status: 'success',
      deviceInfo: 'Scanner Optique Intégré',
    },
  },
  {
    id: 'act-seed-sys-2',
    type: 'PRODUCT_UPDATED',
    category: 'SYSTEM',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(), // 8h ago
    title: 'Mise à jour Fiche Produit',
    description: 'Modification de l\'emplacement et seuil d\'alerte pour Disjoncteur 16A (REF-302)',
    user_name: 'Marie Curie',
    user_trigram: 'MCU',
    product_id: 'REF-302',
    product_ref: 'REF-302',
    depot_name: 'Dépôt Principal',
    meta: {
      status: 'info',
      details: 'Étagère mise à jour vers Bac E1-12',
    },
  },
  {
    id: 'act-seed-scan-3',
    type: 'SCAN_INVENTORY',
    category: 'SCANS',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 14).toISOString(), // 14h ago
    title: 'Scan Comptage Physique',
    description: 'Contrôle quantitatif Mitigeur Eurosmart (REF-404)',
    user_name: 'Jean Dupont',
    user_trigram: 'JDU',
    product_id: 'REF-404',
    product_ref: 'REF-404',
    meta: {
      scannedCode: 'REF-404',
      scanFormat: 'QR_CODE',
      scanMode: 'AUDIT',
      status: 'success',
    },
  },
  {
    id: 'act-seed-sys-3',
    type: 'SYSTEM_SYNC',
    category: 'SYSTEM',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(), // ~1 day ago
    title: 'Sauvegarde & Synchro Supabase',
    description: 'Contrôle d\'intégrité des tables distantes et synchronisation du cache local',
    user_name: 'Administrateur Général',
    user_trigram: 'ADM',
    meta: {
      status: 'success',
      systemVersion: 'v5.8.0',
    },
  },
  {
    id: 'act-seed-sys-4',
    type: 'DEPOT_UPDATED',
    category: 'SYSTEM',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString(),
    title: 'Contrôle Magasin / Dépôt',
    description: 'Vérification du statut d\'ouverture du Dépôt Principal (Actif)',
    user_name: 'Administrateur Général',
    user_trigram: 'ADM',
    depot_name: 'Dépôt Principal',
    meta: {
      status: 'info',
    },
  },
];

export function getStoredActivities(): ActivityItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_SEED_EVENTS));
      return INITIAL_SEED_EVENTS;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_SEED_EVENTS));
      return INITIAL_SEED_EVENTS;
    }
    return parsed;
  } catch (err) {
    console.warn('Error loading stored activities:', err);
    return INITIAL_SEED_EVENTS;
  }
}

export function saveStoredActivities(activities: ActivityItem[]): void {
  try {
    // Keep max 150 items to keep localStorage slim
    const trimmed = activities.slice(0, 150);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.warn('Error saving stored activities:', err);
  }
}

export function logActivityEvent(event: Omit<ActivityItem, 'id' | 'timestamp'> & { timestamp?: string; id?: string }): ActivityItem {
  const current = getStoredActivities();
  const newItem: ActivityItem = {
    id: event.id || `act-${Date.now()}-${crypto.randomUUID()}`,
    timestamp: event.timestamp || new Date().toISOString(),
    ...event,
  };

  const updated = [newItem, ...current];
  saveStoredActivities(updated);
  return newItem;
}

export function clearAllStoredActivities(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_SEED_EVENTS));
}

/**
 * Combines StockMovements (converted to activities) with stored Scans and System Updates,
 * sorting them strictly by timestamp descending.
 */
export function buildCombinedActivities(
  movements: StockMovement[],
  products: Product[],
  storedEvents: ActivityItem[]
): ActivityItem[] {
  const prodMap = new Map<string, Product>();
  for (const p of products) {
    prodMap.set(p.id, p);
    if (p.reference) prodMap.set(p.reference, p);
  }

  // Only process the latest 80 movements to keep the activity feed fast and responsive
  const recentMovements = movements.length > 80 ? movements.slice(-80) : movements;

  // Convert Stock Movements into ActivityItems
  const movementActivities: ActivityItem[] = recentMovements.map((m) => {
    const isOut = m.movement_type === 'OUT';
    const prod = prodMap.get(m.product_id) || (m.product_ref ? prodMap.get(m.product_ref) : undefined);
    const prodName = prod ? `${prod.brand} ${prod.model}` : m.product_ref || 'Outil';

    return {
      id: `mov-act-${m.id}`,
      type: isOut ? 'STOCK_OUT' : 'STOCK_IN',
      category: 'MOVEMENTS',
      timestamp: m.created_at || new Date().toISOString(),
      title: isOut ? `Sortie Chantier : ${prodName}` : `Entrée Réappro : ${prodName}`,
      description: isOut
        ? `Retrait de ${m.quantity_changed} unité(s)${m.site_number ? ` pour le chantier ${m.site_number}` : ''}${m.department_name ? ` (${m.department_name})` : ''}`
        : `Réception de +${m.quantity_changed} unité(s) en stock magasin`,
      badgeText: isOut ? `-${m.quantity_changed}` : `+${m.quantity_changed}`,
      user_name: m.user_name || 'Opérateur',
      product_id: m.product_id,
      product_ref: m.product_ref,
      quantity_changed: m.quantity_changed,
      site_number: m.site_number,
      depot_name: prod?.store_name || null,
      meta: {
        totalCost: m.total_cost,
        unitPrice: prod?.unit_price,
        status: isOut ? 'warning' : 'success',
      },
    };
  });

  // Combine and sort
  const all = [...movementActivities, ...storedEvents];
  all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return all;
}

/**
 * Format relative time in a localized and human-friendly way
 */
export function formatRelativeTime(isoString: string, lang: 'fr' | 'en' = 'fr'): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;

    const now = Date.now();
    const diffMs = now - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 60) {
      return lang === 'fr' ? 'À l\'instant' : 'Just now';
    }
    if (diffMin < 60) {
      return lang === 'fr' ? `Il y a ${diffMin} min` : `${diffMin}m ago`;
    }
    if (diffHours < 24) {
      return lang === 'fr' ? `Il y a ${diffHours} h` : `${diffHours}h ago`;
    }
    if (diffDays === 1) {
      const timeStr = d.toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-US', { hour: '2-digit', minute: '2-digit' });
      return lang === 'fr' ? `Hier à ${timeStr}` : `Yesterday at ${timeStr}`;
    }
    if (diffDays < 7) {
      return lang === 'fr' ? `Il y a ${diffDays} j` : `${diffDays}d ago`;
    }

    return d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}
