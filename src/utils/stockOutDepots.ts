import type { Product, StockLevel, Depot, User, Department } from '../types';
import { isUserAllowedForDepot, isDepotClosed } from './crypto';
import { canUserBorrowFromDepot, canUserViewDepot } from './depotPermissions';

/**
 * V61 — Magasins (dépôts) proposés pour une SORTIE de stock :
 * uniquement ceux où l'article est réellement en stock (> 0), actifs, visibles et autorisés pour l'utilisateur
 * (règle véhicules : seul le conducteur / binôme peut prélever sur un véhicule).
 */
export interface StockOutDepotOption {
  depotName: string;
  currentQty: number;
  rackLocation?: string;
}

const norm = (s?: string | null) => (s || '').trim().toLowerCase();

export function getEligibleStockOutDepotsForProduct(
  product: Pick<Product, 'id' | 'store_name' | 'quantity'> | null | undefined,
  stockLevels: StockLevel[] | undefined,
  depots: Depot[] | undefined,
  user: User | null | undefined,
  language: string,
  departments?: Department[],
  allUsers?: User[]
): StockOutDepotOption[] {
  if (!product || !user) return [];
  const pid = String(product.id);
  const levels = (stockLevels || []).filter((sl) => String(sl.product_id) === pid);

  // Sans niveaux par dépôt (anciennes données) : seul le dépôt par défaut de l'article existe.
  const rows: StockOutDepotOption[] =
    levels.length > 0
      ? levels.map((sl) => ({
          depotName: (sl.depot_name || '').trim(),
          currentQty: Number(sl.quantity) || 0,
          rackLocation: sl.rack_location || undefined,
        }))
      : [
          {
            depotName: (product.store_name || 'Dépôt Principal').trim(),
            currentQty: Number(product.quantity) || 0,
          },
        ];

  const seen = new Set<string>();
  const out: StockOutDepotOption[] = [];
  for (const r of rows) {
    const key = norm(r.depotName);
    if (!key || seen.has(key) || r.currentQty <= 0) continue;
    if (isDepotClosed(depots, r.depotName)) continue;
    if (!isUserAllowedForDepot(user, r.depotName)) continue;
    const depot = (depots || []).find((d) => norm(d.name) === key);
    if (depot && !canUserViewDepot(depot, user, allUsers || [], departments || [])) continue;
    if (!canUserBorrowFromDepot(user, r.depotName, depots, language, departments, allUsers).allowed) continue;
    seen.add(key);
    out.push(r);
  }
  // Dépôt par défaut de l'article en premier
  const def = norm(product.store_name);
  out.sort((a, b) => (norm(b.depotName) === def ? 1 : 0) - (norm(a.depotName) === def ? 1 : 0));
  return out;
}

/**
 * Dépôt de sortie effectif d'une ligne de panier : le choix explicite s'il est autorisé,
 * sinon le dépôt par défaut de l'article, sinon le premier dépôt éligible.
 */
export function resolveStockOutDepot(
  item: { product: Product; targetDepotName?: string },
  eligible: StockOutDepotOption[]
): string {
  const chosen = norm(item.targetDepotName);
  const hit = eligible.find((e) => norm(e.depotName) === chosen);
  if (hit) return hit.depotName;
  const def = eligible.find((e) => norm(e.depotName) === norm(item.product.store_name));
  if (def) return def.depotName;
  if (eligible.length > 0) return eligible[0].depotName;
  return (item.product.store_name || 'Dépôt Principal').trim();
}
