import type { SupabaseClient } from '@supabase/supabase-js';
import {
  Depot,
  LicenseInfo,
  PLAN_LABELS,
  PLAN_TIERS,
  normalizeToCanonicalPlan,
} from '../types';
import { upsertDepotToSupabase, DepotSyncResult } from './clientSupabase';
import { syncLicenseToClientDatabase } from './licenseService';
import { tr } from '../i18n/dutchTranslator';
import type { Language } from '../i18n/translations';

/**
 * Ensemble des clés de dépôts actuellement en cours d'enregistrement (LOT 3 v43).
 * Empêche `syncFromSupabase`, `runSilentLiveSync` (polling 6s) et `hydrateFromLocalStorage`
 * d'écraser un dépôt pendant son appel serveur.
 */
const inFlightDepotKeys = new Set<string>();

function getDepotInFlightTokens(depot: Partial<Depot> | null | undefined): string[] {
  if (!depot) return [];
  const tokens: string[] = [];
  if (depot.id !== undefined && depot.id !== null && String(depot.id).trim() !== '') {
    tokens.push(`id:${String(depot.id).trim().toLowerCase()}`);
  }
  if (typeof depot.name === 'string' && depot.name.trim() !== '') {
    tokens.push(`name:${depot.name.trim().toLowerCase()}`);
  }
  return tokens;
}

export function markDepotMutationStart(
  ...depotsToLock: Array<Partial<Depot> | null | undefined>
): string[] {
  const added: string[] = [];
  for (const d of depotsToLock) {
    for (const token of getDepotInFlightTokens(d)) {
      inFlightDepotKeys.add(token);
      added.push(token);
    }
  }
  return added;
}

export function markDepotMutationEnd(tokens: string[]): void {
  for (const token of tokens) {
    inFlightDepotKeys.delete(token);
  }
}

export function clearAllInFlightDepotMutations(): void {
  inFlightDepotKeys.clear();
}

export function isDepotMutationInFlight(
  depot: Partial<Depot> | null | undefined,
  activeSet: ReadonlySet<string> = inFlightDepotKeys
): boolean {
  const tokens = getDepotInFlightTokens(depot);
  return tokens.some((t) => activeSet.has(t));
}

/**
 * Fusionne la liste de dépôts issue d'un rafraîchissement automatique (`syncFromSupabase` / polling 6s)
 * en préservant l'état local de tout dépôt actuellement en cours de modification (`inFlightDepotKeys`).
 */
export function mergeDepotsPreservingInFlight(
  currentDepots: Depot[],
  incomingDepots: Depot[],
  activeSet: ReadonlySet<string> = inFlightDepotKeys
): Depot[] {
  if (!activeSet || activeSet.size === 0) {
    return incomingDepots;
  }

  const inFlightById = new Map<string, Depot>();
  const inFlightByName = new Map<string, Depot>();

  for (const d of currentDepots) {
    if (isDepotMutationInFlight(d, activeSet)) {
      if (d.id !== undefined && d.id !== null) {
        inFlightById.set(String(d.id).trim().toLowerCase(), d);
      }
      if (d.name) {
        inFlightByName.set(d.name.trim().toLowerCase(), d);
      }
    }
  }

  const usedInFlightIds = new Set<string>();
  const usedInFlightNames = new Set<string>();

  const merged = incomingDepots.map((inc) => {
    const idKey = inc.id !== undefined && inc.id !== null ? String(inc.id).trim().toLowerCase() : '';
    const nameKey = inc.name ? inc.name.trim().toLowerCase() : '';

    if (idKey && inFlightById.has(idKey)) {
      usedInFlightIds.add(idKey);
      const local = inFlightById.get(idKey)!;
      if (local.name) usedInFlightNames.add(local.name.trim().toLowerCase());
      return local;
    }
    if (nameKey && inFlightByName.has(nameKey)) {
      usedInFlightNames.add(nameKey);
      const local = inFlightByName.get(nameKey)!;
      if (local.id !== undefined && local.id !== null) {
        usedInFlightIds.add(String(local.id).trim().toLowerCase());
      }
      return local;
    }
    return inc;
  });

  // Conserver aussi tout nouveau dépôt en cours de création qui n'est pas encore dans incomingDepots
  for (const d of currentDepots) {
    if (!isDepotMutationInFlight(d, activeSet)) continue;
    const idKey = d.id !== undefined && d.id !== null ? String(d.id).trim().toLowerCase() : '';
    const nameKey = d.name ? d.name.trim().toLowerCase() : '';
    if ((idKey && usedInFlightIds.has(idKey)) || (nameKey && usedInFlightNames.has(nameKey))) {
      continue;
    }
    merged.push(d);
  }

  return merged;
}

export interface SaveDepotWithRollbackOptions {
  depots: Depot[];
  depotData: Partial<Depot> & { name: string };
  maxDepots: number;
  license?: LicenseInfo | null;
  client: SupabaseClient | null;
  language?: Language;
  onSetDepots: (updater: (prev: Depot[]) => Depot[]) => void;
  onRenameDepotInProducts?: (oldName: string, newName: string) => void;
  upsertFn?: (client: SupabaseClient | null, depot: Depot) => Promise<DepotSyncResult>;
  syncLicenseFn?: (license: LicenseInfo, client: SupabaseClient | null) => Promise<any>;
}

export interface SaveDepotWithRollbackResult {
  success: boolean;
  message: string;
  depot?: Depot;
  rolledBack?: boolean;
}

/**
 * Exécute la création ou modification (y compris réactivation / mise en veille) d'un dépôt :
 * - verrouille le dépôt contre les rafraîchissements automatiques pendant l'appel serveur ;
 * - en cas de refus serveur (toute erreur hors panne réseau), restaure l'état précédent (pour un dépôt existant comme nouveau)
 *   et renvoie « Refusé par le serveur : <message> » ;
 * - en cas de succès, applique l'état confirmé par le serveur.
 */
export async function executeSaveDepotWithRollback(
  options: SaveDepotWithRollbackOptions
): Promise<SaveDepotWithRollbackResult> {
  const {
    depots,
    depotData,
    maxDepots,
    license,
    client,
    language = 'fr',
    onSetDepots,
    onRenameDepotInProducts,
    upsertFn = upsertDepotToSupabase,
    syncLicenseFn = syncLicenseToClientDatabase,
  } = options;

  const cleanName = (depotData.name || '').trim();
  if (!cleanName) {
    return {
      success: false,
      message: tr(
        language,
        'Le nom du magasin / dépôt est requis.',
        'Store / depot name is required.',
        'De naam van het magazijn / depot is verplicht.'
      ),
    };
  }

  const duplicateName = depots.find(
    (d) =>
      d.name.toLowerCase() === cleanName.toLowerCase() &&
      (depotData.id === undefined || String(d.id) !== String(depotData.id))
  );
  if (duplicateName) {
    return {
      success: false,
      message: tr(
        language,
        `Un magasin ou dépôt portant le nom "${cleanName}" existe déjà.`,
        `A store or depot named "${cleanName}" already exists.`,
        `Er bestaat al een magazijn of depot met de naam "${cleanName}".`
      ),
    };
  }

  const existingIndex =
    depotData.id !== undefined
      ? depots.findIndex((d) => String(d.id) === String(depotData.id))
      : depots.findIndex((d) => d.name.trim().toLowerCase() === cleanName.toLowerCase());

  const activeDepotsCount = depots.filter((d) => d.is_active !== false).length;
  const willBeActive = depotData.is_active !== false;
  const isExistingInactive = existingIndex >= 0 && depots[existingIndex].is_active === false;

  if ((existingIndex === -1 || isExistingInactive) && willBeActive && activeDepotsCount >= maxDepots) {
    const planTier = PLAN_TIERS[license?.plan_type || 'free'];
    const planName = planTier?.name || 'actuel';
    // Si aucun client Supabase n'est connecté, bloquer immédiatement côté local.
    // Si un client Supabase est connecté et qu'on réactive ou crée un dépôt, on laisse également le serveur
    // trancher si le plafond local est déjà atteint ? Non : si localement activeDepotsCount >= maxDepots,
    // si le client n'est pas connecté on bloque, et si connecté on peut quand même tenter ou renvoyer le refus.
    if (!client) {
      return {
        success: false,
        message: tr(
          language,
          `Refusé par le serveur : Limite de licence atteinte (${planName} : ${maxDepots} dépôt(s) actif(s) max).`,
          `Rejected by server: License limit reached (${planName}: max ${maxDepots} active depot(s)).`,
          `Geweigerd door de server: Licentielimiet bereikt (${planName}: max. ${maxDepots} actieve depot(s)).`
        ),
      };
    }
  }

  if (depotData.is_active === false) {
    const plan = normalizeToCanonicalPlan(license?.plan || license?.plan_type, license?.license_key);
    if (plan === 'free') {
      return {
        success: false,
        message: tr(
          language,
          `La mise en veille / fermeture temporaire d’un magasin ou dépôt est disponible à partir du forfait ${PLAN_LABELS.sta} (3 dépôts, gestion chantiers). Passez au forfait ${PLAN_LABELS.sta} pour utiliser cette fonctionnalité.`,
          `Putting a store or depot on standby is available starting from the ${PLAN_LABELS.sta} plan.`,
          `Het op stand-by zetten van een magazijn of depot is beschikbaar vanaf het ${PLAN_LABELS.sta}-pakket.`
        ),
      };
    }
  }

  const oldDepot: Depot | null = existingIndex >= 0 ? { ...depots[existingIndex] } : null;
  let updatedDepot: Depot;

  if (existingIndex >= 0 && oldDepot) {
    updatedDepot = {
      ...oldDepot,
      ...depotData,
      name: cleanName,
      type: depotData.type || oldDepot.type || 'FIXED',
      vehicle_type: depotData.vehicle_type !== undefined ? depotData.vehicle_type : oldDepot.vehicle_type,
      license_plate: depotData.license_plate !== undefined ? depotData.license_plate : oldDepot.license_plate,
      manager_id: depotData.manager_id !== undefined ? depotData.manager_id : oldDepot.manager_id,
      manager_name: depotData.manager_name !== undefined ? depotData.manager_name : oldDepot.manager_name,
      binome_ids: depotData.binome_ids !== undefined ? depotData.binome_ids : oldDepot.binome_ids,
      binome_names: depotData.binome_names !== undefined ? depotData.binome_names : oldDepot.binome_names,
      department_id: depotData.department_id !== undefined ? depotData.department_id : oldDepot.department_id,
      department_name: depotData.department_name !== undefined ? depotData.department_name : oldDepot.department_name,
      is_active: depotData.is_active !== undefined ? depotData.is_active : (oldDepot.is_active ?? true),
      updated_at: new Date().toISOString(),
    };
  } else {
    updatedDepot = {
      id: depotData.id || Date.now(),
      name: cleanName,
      code: depotData.code?.trim() || `DEP-${String(depots.length + 1).padStart(2, '0')}`,
      address: depotData.address?.trim() || '',
      description: depotData.description?.trim() || '',
      type: depotData.type || 'FIXED',
      vehicle_type: depotData.vehicle_type?.trim() || undefined,
      license_plate: depotData.license_plate?.trim() || undefined,
      manager_id: depotData.manager_id || null,
      manager_name: depotData.manager_name || null,
      binome_ids: depotData.binome_ids || [],
      binome_names: depotData.binome_names || [],
      department_id: depotData.department_id || null,
      department_name: depotData.department_name || null,
      pickup_zones: depotData.pickup_zones || [],
      is_active: depotData.is_active ?? true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  const lockTokens = markDepotMutationStart(oldDepot, updatedDepot);

  // Appliquer l'état optimiste localement (protégé par lockTokens contre syncFromSupabase)
  if (existingIndex >= 0 && oldDepot) {
    onSetDepots((prev) =>
      prev.map((d) =>
        String(d.id) === String(oldDepot.id) || d.name.toLowerCase() === oldDepot.name.toLowerCase()
          ? updatedDepot
          : d
      )
    );
  } else {
    onSetDepots((prev) => [...prev, updatedDepot]);
  }

  try {
    if (!client) {
      if (oldDepot && oldDepot.name.toLowerCase() !== cleanName.toLowerCase() && onRenameDepotInProducts) {
        onRenameDepotInProducts(oldDepot.name, cleanName);
      }
      return {
        success: true,
        message: tr(
          language,
          `Dépôt "${cleanName}" enregistré avec succès ! (Stocké localement - Supabase non connecté)`,
          `Depot "${cleanName}" saved successfully! (Stored locally - Supabase disconnected)`,
          `Depot "${cleanName}" succesvol opgeslagen! (Lokaal opgeslagen - Supabase niet verbonden)`
        ),
        depot: updatedDepot,
      };
    }

    let syncRes = await upsertFn(client, updatedDepot);
    if (
      !syncRes.success &&
      !syncRes.isNetworkError &&
      syncRes.error &&
      license &&
      (syncRes.error.toLowerCase().includes('quota') ||
        syncRes.error.toLowerCase().includes('licence') ||
        syncRes.error.toLowerCase().includes('license'))
    ) {
      // Tenter de resynchroniser la licence vers la base cliente puis réessayer une fois
      const licSync = await syncLicenseFn(license, client).catch(() => ({ success: false }));
      if (licSync && licSync.success) {
        syncRes = await upsertFn(client, updatedDepot);
      }
    }

    if (syncRes.success) {
      const serverRow = syncRes.inserted ? (syncRes.inserted as Partial<Depot>) : undefined;
      const confirmedDepot: Depot = {
        ...updatedDepot,
        ...(serverRow || {}),
        id: serverRow?.id !== undefined ? serverRow.id : updatedDepot.id,
        name: serverRow?.name ? String(serverRow.name).trim() : updatedDepot.name,
        is_active:
          serverRow?.is_active !== undefined ? Boolean(serverRow.is_active) : updatedDepot.is_active,
      };

      onSetDepots((prev) =>
        prev.map((d) => {
          const matchesUpdated =
            String(d.id) === String(updatedDepot.id) ||
            d.name.toLowerCase() === cleanName.toLowerCase() ||
            (oldDepot &&
              (String(d.id) === String(oldDepot.id) ||
                d.name.toLowerCase() === oldDepot.name.toLowerCase()));
          return matchesUpdated ? confirmedDepot : d;
        })
      );

      if (oldDepot && oldDepot.name.toLowerCase() !== confirmedDepot.name.toLowerCase() && onRenameDepotInProducts) {
        onRenameDepotInProducts(oldDepot.name, confirmedDepot.name);
      }

      return {
        success: true,
        message: tr(
          language,
          `Dépôt "${confirmedDepot.name}" enregistré avec succès ! • Synchro SQL Supabase OK (${syncRes.table || 'stk_depots'})`,
          `Depot "${confirmedDepot.name}" saved successfully! • Supabase SQL sync OK (${syncRes.table || 'stk_depots'})`,
          `Depot "${confirmedDepot.name}" succesvol opgeslagen! • Supabase SQL-synchronisatie OK (${syncRes.table || 'stk_depots'})`
        ),
        depot: confirmedDepot,
      };
    }

    if (syncRes.isNetworkError) {
      if (oldDepot && oldDepot.name.toLowerCase() !== cleanName.toLowerCase() && onRenameDepotInProducts) {
        onRenameDepotInProducts(oldDepot.name, cleanName);
      }
      return {
        success: true,
        message: tr(
          language,
          `Dépôt "${cleanName}" enregistré localement • ⚠️ Serveur Supabase inaccessible (Failed to fetch).`,
          `Depot "${cleanName}" saved locally • ⚠️ Supabase server unreachable (Failed to fetch).`,
          `Depot "${cleanName}" lokaal opgeslagen • ⚠️ Supabase-server onbereikbaar (Failed to fetch).`
        ),
        depot: updatedDepot,
      };
    }

    // LOT 3 v43 : Tout refus serveur (quota, RLS, trigger, contrainte, table manquante...) restaure l'état précédent
    if (existingIndex >= 0 && oldDepot) {
      onSetDepots((prev) =>
        prev.map((d) => {
          const matchesTarget =
            String(d.id) === String(updatedDepot.id) ||
            String(d.id) === String(oldDepot.id) ||
            d.name.toLowerCase() === cleanName.toLowerCase() ||
            d.name.toLowerCase() === oldDepot.name.toLowerCase();
          return matchesTarget ? oldDepot : d;
        })
      );
    } else {
      onSetDepots((prev) =>
        prev.filter(
          (d) =>
            String(d.id) !== String(updatedDepot.id) &&
            d.name.toLowerCase() !== cleanName.toLowerCase()
        )
      );
    }

    const reason = syncRes.error || 'Opération refusée.';
    return {
      success: false,
      rolledBack: true,
      message: tr(
        language,
        `Refusé par le serveur : ${reason}`,
        `Rejected by server: ${reason}`,
        `Geweigerd door de server: ${reason}`
      ),
    };
  } finally {
    markDepotMutationEnd(lockTokens);
  }
}
