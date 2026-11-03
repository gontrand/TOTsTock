import { Depot, User, Department, Project } from '../types';
import { isDepotClosed, isUserAllowedForDepot } from './crypto';

// String normalization helper (ignores case, spaces, and accents)
export const normalizeDepotString = (str?: string | null): string => {
  if (!str) return '';
  return str
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
};

/**
 * Checks whether a depot is a vehicle / mobile depot or container
 * (En utilisant strictement le champ type = 'VEHICLE' ou 'CONTAINER')
 */
export function isDepotVehicleOrContainer(depot?: Depot | null): boolean {
  if (!depot) return false;
  return depot.type === 'VEHICLE' || depot.type === 'CONTAINER';
}

/**
 * Checks whether a depot is a container
 */
export function isDepotContainer(depot?: Depot | null): boolean {
  if (!depot) return false;
  return depot.type === 'CONTAINER';
}

/**
 * Checks whether a user is the Site Manager / Conducteur de travaux or deputy for a project
 */
export function isUserProjectManagerOrDeputy(
  user: User | { id?: string | number } | null | undefined,
  projectNumber?: string | null,
  projects?: Project[] | null
): boolean {
  if (!user || !projectNumber || !projects || projects.length === 0) return false;
  const userIdStr = String(user.id);
  const targetProj = projects.find((p) => p.project_number === projectNumber);
  if (!targetProj) return false;

  const isManager = targetProj.manager_id && String(targetProj.manager_id) === userIdStr;
  const isDeputy =
    targetProj.deputy_manager_ids &&
    Array.isArray(targetProj.deputy_manager_ids) &&
    targetProj.deputy_manager_ids.some((id) => String(id) === userIdStr);

  return Boolean(isManager || isDeputy);
}

/**
 * Checks if a user belongs to Logistics or Executive Management (Logistique / Direction)
 */
export function isUserInLogisticsOrDirection(user?: User | { department?: string } | null): boolean {
  if (!user?.department) return false;
  const dept = user.department.toLowerCase().trim();
  return dept.includes('logistique') || dept.includes('direction');
}

/**
 * Checks whether a user is the Manager or a Deputy Manager of the department associated with this depot
 */
export function isUserDeptManagerOrDeputyForDepot(
  user: User | { id?: string | number } | null | undefined,
  depot: Depot | null | undefined,
  departments?: Department[] | null,
  allUsers?: User[] | null
): boolean {
  if (!user || !depot || !departments || departments.length === 0) return false;
  const userIdStr = String(user.id);

  // 1. Direct link via depot.department_id or depot.department_name
  let targetDept = departments.find((d) => {
    if (depot.department_id && String(d.id) === String(depot.department_id)) return true;
    if (depot.department_name && d.name.toLowerCase().trim() === depot.department_name.toLowerCase().trim()) return true;
    return false;
  });

  // 2. Fallback: check department of the depot's vehicle manager / driver
  if (!targetDept && depot.manager_id && allUsers) {
    const chauffeur = allUsers.find((u) => String(u.id) === String(depot.manager_id));
    if (chauffeur?.department) {
      targetDept = departments.find(
        (d) => d.name.toLowerCase().trim() === chauffeur.department!.toLowerCase().trim()
      );
    }
  }

  if (!targetDept) return false;

  // Check if user is department manager or listed in deputy_manager_ids
  const isManager = targetDept.manager_id && String(targetDept.manager_id) === userIdStr;
  const isDeputy =
    targetDept.deputy_manager_ids &&
    Array.isArray(targetDept.deputy_manager_ids) &&
    targetDept.deputy_manager_ids.some((id) => String(id) === userIdStr);

  return Boolean(isManager || isDeputy);
}

/**
 * Finds a depot by its name, code or id
 */
export function findDepotByName(
  depots: Depot[] | undefined | null,
  depotName?: string | null
): Depot | undefined {
  if (!depots || depots.length === 0) return undefined;
  const targetNorm = normalizeDepotString(depotName || depots[0]?.name || 'Dépôt Principal');
  if (!targetNorm) return undefined;

  return depots.find((d) => {
    const dNameNorm = normalizeDepotString(d.name);
    const dCodeNorm = normalizeDepotString(d.code);
    const dIdStr = String(d.id || '').toLowerCase().trim();
    return dNameNorm === targetNorm || dCodeNorm === targetNorm || dIdStr === targetNorm;
  });
}

/**
 * Checks whether a depot is a vehicle / mobile depot
 */
export function isDepotVehicle(depot?: Depot | null): boolean {
  if (!depot) return false;
  return depot.type === 'VEHICLE';
}

/**
 * Checks whether a user is the primary assigned driver/holder of the vehicle
 */
export function isUserVehicleHolder(
  user: User | { id?: string | number; name?: string; role_id?: number } | null | undefined,
  depot: Depot | null | undefined
): boolean {
  if (!user || !depot || depot.type !== 'VEHICLE') return false;

  const userIdStr = String(user.id ?? '');
  const managerIdStr = String(depot.manager_id ?? '');

  if (userIdStr && managerIdStr && userIdStr === managerIdStr) {
    return true;
  }

  if (user.name && depot.manager_name) {
    if (normalizeDepotString(user.name) === normalizeDepotString(depot.manager_name)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether a user is an authorized binôme (team partner) for this vehicle
 */
export function isUserVehicleBinome(
  user: User | { id?: string | number; name?: string; role_id?: number; binome_id?: string | number | null } | null | undefined,
  depot: Depot | null | undefined
): boolean {
  if (!user || !depot || depot.type !== 'VEHICLE') return false;

  const userIdStr = String(user.id ?? '');
  const userNameNorm = normalizeDepotString(user.name);

  // Check depot.binome_ids
  if (depot.binome_ids && Array.isArray(depot.binome_ids)) {
    const isMatched = depot.binome_ids.some((id) => String(id) === userIdStr);
    if (isMatched) return true;
  }

  // Check depot.binome_names
  if (depot.binome_names && Array.isArray(depot.binome_names) && userNameNorm) {
    const isMatched = depot.binome_names.some((name) => normalizeDepotString(name) === userNameNorm);
    if (isMatched) return true;
  }

  // Check if user's paired binome is the vehicle manager
  if (user.binome_id && depot.manager_id && String(user.binome_id) === String(depot.manager_id)) {
    return true;
  }

  return false;
}

/**
 * Checks whether a user is either the assigned holder OR one of the binômes of a vehicle depot
 */
export function isUserVehicleHolderOrBinome(
  user: User | { id?: string | number; name?: string; role_id?: number; binome_id?: string | number | null } | null | undefined,
  depot: Depot | null | undefined
): boolean {
  if (!user || !depot) return false;
  return isUserVehicleHolder(user, depot) || isUserVehicleBinome(user, depot);
}

/**
 * Returns all vehicle depots assigned to the user (as holder or binôme)
 */
export function getUserVehicles(
  user: User | null | undefined,
  depots: Depot[] | null | undefined
): Depot[] {
  if (!user || !depots) return [];
  return depots.filter((d) => d.type === 'VEHICLE' && isUserVehicleHolderOrBinome(user, d));
}

export interface DepotPermissionCheckResult {
  allowed: boolean;
  reason?: string;
  isVehicle?: boolean;
  isVehicleHolder?: boolean;
  isVehicleBinome?: boolean;
  depot?: Depot;
}

/**
 * Validates if the user is authorized to BORROW / WITHDRAW (OUT / Sortie) from a specific depot.
 */
export function canUserBorrowFromDepot(
  user: User | null | undefined,
  depotName: string | null | undefined,
  depots: Depot[] | null | undefined,
  lang: string = 'fr',
  departments?: Department[] | null,
  allUsers?: User[] | null,
  projects?: Project[] | null
): DepotPermissionCheckResult {
  if (!user) {
    return {
      allowed: false,
      reason: lang === 'fr' ? 'Utilisateur non connecté.' : 'User not logged in.',
    };
  }

  // SuperAdmin (ID 0 or Role 0) or Administrateur (Role 1) have full oversight
  const isSuperOrAdmin = Number(user.id) === 0 || Number(user.role_id) === 0 || Number(user.role_id) === 1;

  // Check if depot is closed
  if (isDepotClosed(depots, depotName)) {
    return {
      allowed: false,
      reason:
        lang === 'fr'
          ? `Sortie impossible : Le dépôt « ${depotName || 'Dépôt principal'} » est actuellement fermé ou inactif.`
          : `Withdrawal prohibited: Depot "${depotName || 'Main'}" is currently closed or inactive.`,
    };
  }

  const depot = findDepotByName(depots, depotName);

  // If it is a vehicle or container depot
  if (depot && isDepotVehicleOrContainer(depot)) {
    const isHolder = isUserVehicleHolder(user, depot);
    const isBinome = isUserVehicleBinome(user, depot);
    const isDeptManagerOrDeputy = isUserDeptManagerOrDeputyForDepot(user, depot, departments, allUsers);
    const isProjectManagerOrDeputy =
      depot.type === 'CONTAINER' && isUserProjectManagerOrDeputy(user, depot.project_number, projects);
    const isInLogisticsOrDirection = isUserInLogisticsOrDirection(user);

    // Rule: Department Managers & deputies, vehicle holders, binômes, and project managers on container
    if (isSuperOrAdmin || isHolder || isBinome || isDeptManagerOrDeputy || isProjectManagerOrDeputy) {
      return {
        allowed: true,
        isVehicle: depot.type === 'VEHICLE',
        isVehicleHolder: isHolder,
        isVehicleBinome: isBinome,
        depot,
      };
    }

    // Rule: Logistics and Executive Management can view all vehicle/containers but CANNOT perform actions!
    if (isInLogisticsOrDirection) {
      return {
        allowed: false,
        isVehicle: depot.type === 'VEHICLE',
        isVehicleHolder: false,
        isVehicleBinome: false,
        depot,
        reason:
          lang === 'fr'
            ? `🚫 Consultation seule : Le département « ${user.department} » peut consulter les stocks des camionnettes et conteneurs mais ne peut pas effectuer d'emprunt ou de sortie.`
            : `🚫 View only: Department "${user.department}" has read-only access to vehicles and containers (no withdrawal allowed).`,
      };
    }

    // Unauthorized access to someone else's vehicle or container
    const holderName = depot.manager_name || (lang === 'fr' ? 'conducteur titulaire' : 'assigned driver');
    return {
      allowed: false,
      isVehicle: depot.type === 'VEHICLE',
      isVehicleHolder: false,
      isVehicleBinome: false,
      depot,
      reason:
        lang === 'fr'
          ? `🚫 Emprunt interdit : Seul le titulaire (${holderName}), ses binômes ou les responsables du département/chantier sont autorisés à prélever du matériel dans « ${depot.name} ».`
          : `🚫 Borrowing prohibited: Only assigned holder (${holderName}), binômes, or department/project managers are authorized to borrow items from "${depot.name}".`,
    };
  }

  // For fixed / standard depots: verify allowed_depots
  const allowed = isUserAllowedForDepot(user, depotName);
  if (!allowed) {
    return {
      allowed: false,
      depot,
      reason:
        lang === 'fr'
          ? `🚫 Prélèvement interdit : Vous n'avez pas accès au dépôt « ${depotName || 'Non défini'} ». Vos dépôts autorisés : ${
              user.allowed_depots?.join(', ') || 'Aucun'
            }.`
          : `🚫 Withdrawal prohibited: You do not have access to depot "${depotName}".`,
    };
  }

  return { allowed: true, depot };
}

/**
 * Validates if the user is authorized to perform STOCK ENTRY (IN / Entrée de stock) in a specific depot.
 */
export function canUserEnterStockInDepot(
  user: User | null | undefined,
  depotName: string | null | undefined,
  depots: Depot[] | null | undefined,
  hasGeneralStockInPerm: boolean,
  lang: string = 'fr',
  departments?: Department[] | null,
  allUsers?: User[] | null,
  projects?: Project[] | null
): DepotPermissionCheckResult {
  if (!user) {
    return {
      allowed: false,
      reason: lang === 'fr' ? 'Utilisateur non connecté.' : 'User not logged in.',
    };
  }

  // SuperAdmin (ID 0 or Role 0) or Administrateur (Role 1) have full oversight
  const isSuperOrAdmin = Number(user.id) === 0 || Number(user.role_id) === 0 || Number(user.role_id) === 1;
  if (isSuperOrAdmin) {
    return { allowed: true };
  }

  // Check if depot is closed
  if (isDepotClosed(depots, depotName)) {
    return {
      allowed: false,
      reason:
        lang === 'fr'
          ? `Entrée impossible : Le dépôt « ${depotName || 'Dépôt principal'} » est actuellement fermé ou inactif.`
          : `Stock entry prohibited: Depot "${depotName || 'Main'}" is currently closed or inactive.`,
    };
  }

  const depot = findDepotByName(depots, depotName);

  // If depot is a VEHICLE or CONTAINER
  if (depot && isDepotVehicleOrContainer(depot)) {
    const isHolder = isUserVehicleHolder(user, depot);
    const isBinome = isUserVehicleBinome(user, depot);
    const isDeptManagerOrDeputy = isUserDeptManagerOrDeputyForDepot(user, depot, departments, allUsers);
    const isProjectManagerOrDeputy =
      depot.type === 'CONTAINER' && isUserProjectManagerOrDeputy(user, depot.project_number, projects);
    const isInLogisticsOrDirection = isUserInLogisticsOrDirection(user);

    // Rule: Holder, Binôme, Department Managers/Deputies, and Project Managers on container
    if (isHolder || isBinome || isDeptManagerOrDeputy || isProjectManagerOrDeputy) {
      return {
        allowed: true,
        isVehicle: depot.type === 'VEHICLE',
        isVehicleHolder: isHolder,
        isVehicleBinome: isBinome,
        depot,
      };
    }

    // Rule: Logistics and Executive Management can view all vehicle/containers but CANNOT perform actions!
    if (isInLogisticsOrDirection) {
      return {
        allowed: false,
        isVehicle: depot.type === 'VEHICLE',
        depot,
        reason:
          lang === 'fr'
            ? `🚫 Consultation seule : Le département « ${user.department} » peut consulter les stocks des camionnettes et conteneurs mais ne peut pas y entrer du stock.`
            : `🚫 View only: Department "${user.department}" has read-only access to vehicles and containers (no stock entry allowed).`,
      };
    }

    // If someone else's vehicle:
    if (hasGeneralStockInPerm && Number(user.role_id) === 2 && isUserAllowedForDepot(user, depotName)) {
      return { allowed: true, isVehicle: depot.type === 'VEHICLE', depot };
    }

    return {
      allowed: false,
      isVehicle: depot.type === 'VEHICLE',
      depot,
      reason:
        lang === 'fr'
          ? `🚫 Entrée refusée : Vous ne pouvez pas approvisionner ce véhicule/conteneur (« ${depot.name} »). Seul son titulaire, ses binômes ou les responsables de son département/chantier peuvent y entrer du stock.`
          : `🚫 Stock entry denied: You cannot replenish this vehicle/container ("${depot.name}").`,
    };
  }

  // If depot is a FIXED depot (e.g. Dépôt Principal / Magasin central)
  if (!hasGeneralStockInPerm) {
    const userVehicles = getUserVehicles(user, depots);
    const vehicleNotice =
      userVehicles.length > 0
        ? lang === 'fr'
          ? ` Vous êtes uniquement habilité à entrer du stock dans votre camionnette (« ${userVehicles.map((v) => v.name).join(', ')} »).`
          : ` You can only enter stock into your assigned vehicle ("${userVehicles.map((v) => v.name).join(', ')}").`
        : '';

    return {
      allowed: false,
      depot,
      reason:
        lang === 'fr'
          ? `🚫 Entrée non autorisée : Vous n'avez pas l'habilitation d'entrée de stock dans le dépôt « ${
              depotName || 'Dépôt Principal'
            } ».${vehicleNotice}`
          : `🚫 Stock entry prohibited: You do not have permission to receive stock into depot "${
              depotName || 'Main'
            }".${vehicleNotice}`,
    };
  }

  // If user HAS general perm_stock_in: verify depot scope (allowed_depots)
  const isAllowedScope = isUserAllowedForDepot(user, depotName);
  if (!isAllowedScope) {
    return {
      allowed: false,
      depot,
      reason:
        lang === 'fr'
          ? `🚫 Entrée non autorisée : Votre compte n'a pas accès au dépôt « ${depotName || 'Non défini'} ». Vos dépôts autorisés : ${
              user.allowed_depots?.join(', ') || 'Aucun'
            }.`
          : `🚫 Stock entry prohibited: You do not have access to depot "${depotName}".`,
    };
  }

  return { allowed: true, depot };
}

/**
 * Checks whether a user can view / consult the stock contents of a depot.
 * Rule:
 * - SuperAdmin / Admin: can view all.
 * - Logistics / Direction department: CAN VIEW all vehicle and container depots.
 * - Department managers & deputies: can view all vehicle and container depots of their department.
 * - Vehicle holder & binôme: can view their assigned vehicle.
 * - Project manager & deputies of associated project: can view their container depot.
 * - Fixed depots: according to allowed_depots.
 */
export function canUserViewDepot(
  user: User | { id?: string | number; role_id?: number; department?: string; allowed_depots?: string[] } | null | undefined,
  depot: Depot | null | undefined,
  departments?: Department[] | null,
  allUsers?: User[] | null,
  projects?: Project[] | null
): boolean {
  if (!user || !depot) return false;
  if (Number(user.id) === 0 || Number(user.role_id) === 0 || Number(user.role_id) === 1) return true;

  if (isDepotVehicleOrContainer(depot)) {
    // 1. Logistics or Direction can view all vehicle and container depots!
    if (isUserInLogisticsOrDirection(user)) {
      return true;
    }
    // 2. Department manager or deputy can view their department's vehicles/containers
    if (isUserDeptManagerOrDeputyForDepot(user, depot, departments, allUsers)) {
      return true;
    }
    // 3. Vehicle holder or binôme
    if (isUserVehicleHolderOrBinome(user, depot)) {
      return true;
    }
    // 4. Project manager or deputy of the associated site / project
    if (depot.type === 'CONTAINER' && isUserProjectManagerOrDeputy(user, depot.project_number, projects)) {
      return true;
    }
    // 5. If explicitly granted in allowed_depots
    return isUserAllowedForDepot(user, depot.name);
  }

  // Standard fixed depot
  return isUserAllowedForDepot(user, depot.name);
}
