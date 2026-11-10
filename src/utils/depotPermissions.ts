import { Depot, User, Department, Project, Product, StockLevel } from '../types';
import { isDepotClosed, isUserAllowedForDepot } from './crypto';

export const RESTRICTED_VEHICLE_LABEL = 'Véhicule (accès restreint)';

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

export interface ResolvedDepotDepartment {
  id?: number;
  name?: string;
  manager_id?: number | null;
  deputy_manager_ids?: (string | number)[];
  allow_global_kpis?: boolean;
  departmentId: string | number | null;
  departmentName: string | null;
}

/**
 * Resolves the Department associated with a depot (via department_id, department_name, driver's department, or attached project's department).
 */
export function resolveDepotDepartment(
  depot: Depot | null | undefined,
  departments?: Department[] | null,
  allUsers?: User[] | null,
  projects?: Project[] | null
): ResolvedDepotDepartment {
  if (!depot) {
    return { departmentId: null, departmentName: null };
  }

  const depts = Array.isArray(departments) ? departments : [];
  const usersList = Array.isArray(allUsers) ? allUsers : [];
  const projectsList = Array.isArray(projects) ? projects : [];

  // 1. Direct link via depot.department_id or depot.department_name
  const direct = depts.find((d) => {
    if (depot.department_id && String(d.id) === String(depot.department_id)) return true;
    if (
      depot.department_name &&
      normalizeDepotString(d.name) === normalizeDepotString(depot.department_name)
    ) {
      return true;
    }
    return false;
  });
  if (direct) {
    return {
      ...direct,
      departmentId: direct.id,
      departmentName: direct.name,
    };
  }

  // 2. Fallback: check department of the depot's vehicle manager / driver
  if (depot.manager_id && usersList.length > 0) {
    const chauffeur = usersList.find((u) => String(u.id) === String(depot.manager_id));
    if (chauffeur?.department) {
      const matched = depts.find(
        (d) =>
          normalizeDepotString(d.name) === normalizeDepotString(chauffeur.department) ||
          String(d.id) === String(chauffeur.department)
      );
      if (matched) {
        return {
          ...matched,
          departmentId: matched.id,
          departmentName: matched.name,
        };
      }
      return {
        name: chauffeur.department,
        departmentId: depot.department_id ?? null,
        departmentName: chauffeur.department,
      };
    }
  }

  // 3. Fallback for container with project_number
  if (depot.project_number && projectsList.length > 0) {
    const proj = projectsList.find(
      (p) => normalizeDepotString(p.project_number) === normalizeDepotString(depot.project_number)
    );
    if (proj?.department_id != null) {
      const matched = depts.find((d) => String(d.id) === String(proj.department_id));
      if (matched) {
        return {
          ...matched,
          departmentId: matched.id,
          departmentName: matched.name,
        };
      }
      return {
        departmentId: proj.department_id,
        departmentName: depot.department_name ?? null,
      };
    }
  }

  return {
    name: depot.department_name || undefined,
    departmentId: depot.department_id ?? null,
    departmentName: depot.department_name ?? null,
  };
}

/**
 * Returns the resolved department name (string | null) for a depot.
 */
export function resolveDepotDepartmentName(
  depot: Depot | null | undefined,
  allUsers?: User[] | null,
  departments?: Department[] | null,
  projects?: Project[] | null
): string | null {
  const res = resolveDepotDepartment(depot, departments, allUsers, projects);
  return res.departmentName || null;
}

/**
 * Checks whether a user is the Site Manager / Conducteur de travaux or deputy for a specific project_number
 */
export function isUserProjectManagerOrDeputy(
  user: User | { id?: string | number } | null | undefined,
  projectNumber?: string | null,
  projects?: Project[] | null
): boolean {
  if (!user || user.id === undefined || user.id === null || !projectNumber || !projects || projects.length === 0) {
    return false;
  }
  const userIdStr = String(user.id);
  const targetNumNorm = projectNumber.trim().toUpperCase();
  const targetProj = projects.find(
    (p) => (p.project_number || '').trim().toUpperCase() === targetNumNorm
  );
  if (!targetProj) return false;

  const isManager = targetProj.manager_id !== undefined && targetProj.manager_id !== null && String(targetProj.manager_id) === userIdStr;
  const isDeputy =
    Array.isArray(targetProj.deputy_manager_ids) &&
    targetProj.deputy_manager_ids.some((id) => String(id) === userIdStr);

  return Boolean(isManager || isDeputy);
}

/**
 * Checks whether a user is a Project Manager (or deputy) of ANY project attached to the vehicle/container's department
 * (`Project.department_id` matches the depot's department).
 */
export function isUserProjectManagerForDepotDepartment(
  user: User | { id?: string | number } | null | undefined,
  depot: Depot | null | undefined,
  departments?: Department[] | null,
  projects?: Project[] | null,
  allUsers?: User[] | null
): boolean {
  if (!user || user.id === undefined || user.id === null || !depot || !projects || projects.length === 0) {
    return false;
  }
  const userIdStr = String(user.id);
  const targetDept = resolveDepotDepartment(depot, departments, allUsers, projects);
  const deptIdStr = targetDept?.id !== undefined && targetDept?.id !== null
    ? String(targetDept.id)
    : depot.department_id !== undefined && depot.department_id !== null
    ? String(depot.department_id)
    : '';

  if (!deptIdStr) return false;

  return projects.some((p) => {
    if (String(p.department_id) !== deptIdStr) return false;
    const isMgr = p.manager_id !== undefined && p.manager_id !== null && String(p.manager_id) === userIdStr;
    const isDep =
      Array.isArray(p.deputy_manager_ids) &&
      p.deputy_manager_ids.some((id) => String(id) === userIdStr);
    return isMgr || isDep;
  });
}

/**
 * Checks if a user belongs to Logistics or Executive Management (Logistique / Direction)
 */
/**
 * V61 — Sortie directe depuis un dépôt FIXE (magasin central) : réservée aux administrateurs, magasiniers,
 * responsables logistique / magasin, préparateurs et au personnel d'un département coché « Logistique ».
 * Si la liste des départements est inconnue, on ne bloque pas côté application (le serveur applique la règle).
 */
export function canUserDirectOutFromFixedDepot(
  user: User | null | undefined,
  departments?: Department[] | null
): boolean {
  if (!user) return false;
  if (Number(user.id) === 0) return true;
  const role = Number(user.role_id);
  if ([0, 1, 2, 6, 7].includes(role)) return true;
  if ((user as any).is_preparer) return true;
  if (!departments || departments.length === 0) return true;
  const userDept = (user.department || '').trim().toLowerCase();
  if (!userDept) return false;
  return departments.some(
    (d) => d.is_logistics_dept === true && (d.name || '').trim().toLowerCase() === userDept
  );
}

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
  if (!user || user.id === undefined || user.id === null || !depot || !departments || departments.length === 0) {
    return false;
  }
  const userIdStr = String(user.id);
  const targetDept = resolveDepotDepartment(depot, departments, allUsers);
  if (!targetDept || targetDept.id === undefined) return false;

  const isManager = targetDept.manager_id !== undefined && targetDept.manager_id !== null && String(targetDept.manager_id) === userIdStr;
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
 * Checks whether a user is the primary assigned driver/holder of the vehicle or container
 */
export function isUserVehicleHolder(
  user: User | { id?: string | number; name?: string; role_id?: number } | null | undefined,
  depot: Depot | null | undefined
): boolean {
  if (!user || !depot || !isDepotVehicleOrContainer(depot)) return false;

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
 * Checks whether a user is an authorized binôme (team partner) for this vehicle or container
 */
export function isUserVehicleBinome(
  user: User | { id?: string | number; name?: string; role_id?: number; binome_id?: string | number | null } | null | undefined,
  depot: Depot | null | undefined
): boolean {
  if (!user || !depot || !isDepotVehicleOrContainer(depot)) return false;

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
 * Checks whether a user is either the assigned holder OR one of the binômes of a vehicle/container depot
 */
export function isUserVehicleHolderOrBinome(
  user: User | { id?: string | number; name?: string; role_id?: number; binome_id?: string | number | null } | null | undefined,
  depot: Depot | null | undefined
): boolean {
  if (!user || !depot) return false;
  return isUserVehicleHolder(user, depot) || isUserVehicleBinome(user, depot);
}

/**
 * Returns all vehicle/container depots assigned to the user (as holder or binôme)
 */
export function getUserVehicles(
  user: User | null | undefined,
  depots: Depot[] | null | undefined
): Depot[] {
  if (!user || !depots) return [];
  return depots.filter((d) => isDepotVehicleOrContainer(d) && isUserVehicleHolderOrBinome(user, d));
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
      (depot.type === 'CONTAINER' && isUserProjectManagerOrDeputy(user, depot.project_number, projects)) ||
      isUserProjectManagerForDepotDepartment(user, depot, departments, projects, allUsers);

    // Rule: Admins, Department Managers & deputies, vehicle holders, binômes, and project managers
    if (isSuperOrAdmin || isHolder || isBinome || isDeptManagerOrDeputy || isProjectManagerOrDeputy) {
      return {
        allowed: true,
        isVehicle: depot.type === 'VEHICLE',
        isVehicleHolder: isHolder,
        isVehicleBinome: isBinome,
        depot,
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

  // V61 : dépôt fixe — la sortie directe est réservée à la Logistique / magasiniers / administrateurs
  if (!canUserDirectOutFromFixedDepot(user, departments)) {
    return {
      allowed: false,
      depot,
      reason:
        lang === 'fr'
          ? `🚫 Sortie directe interdite sur le dépôt fixe « ${depotName || 'Dépôt principal'} » : passez par une commande (préparée par le magasin) ou demandez au personnel Logistique.`
          : `🚫 Direct withdrawal not allowed from fixed depot "${depotName || 'Main'}": place an order (prepared by the warehouse) or ask Logistics staff.`,
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
      (depot.type === 'CONTAINER' && isUserProjectManagerOrDeputy(user, depot.project_number, projects)) ||
      isUserProjectManagerForDepotDepartment(user, depot, departments, projects, allUsers);

    // Rule: Holder, Binôme, Department Managers/Deputies, and Project Managers
    if (isHolder || isBinome || isDeptManagerOrDeputy || isProjectManagerOrDeputy) {
      return {
        allowed: true,
        isVehicle: depot.type === 'VEHICLE',
        isVehicleHolder: isHolder,
        isVehicleBinome: isBinome,
        depot,
      };
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

function extractUsersDeptsProjects(args: unknown[]): {
  depots?: Depot[];
  departments?: Department[];
  allUsers?: User[];
  projects?: Project[];
} {
  let depots: Depot[] | undefined;
  let departments: Department[] | undefined;
  let allUsers: User[] | undefined;
  let projects: Project[] | undefined;

  for (const arr of args) {
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const first = arr[0] as Record<string, unknown>;
    if (!first || typeof first !== 'object') continue;
    if ('project_number' in first || 'project_name' in first) {
      projects = arr as Project[];
    } else if ('trigram' in first || 'role_id' in first) {
      allUsers = arr as User[];
    } else if ('type' in first || 'pickup_zones' in first || 'license_plate' in first || 'is_active' in first) {
      depots = arr as Depot[];
    } else {
      departments = arr as Department[];
    }
  }
  return { depots, departments, allUsers, projects };
}

function isDepotLikeObject(val: unknown): val is Depot {
  if (!val || typeof val !== 'object') return false;
  const obj = val as Record<string, unknown>;
  if ('trigram' in obj || 'role_id' in obj || 'allowed_depots' in obj) return false;
  return 'type' in obj || 'manager_id' in obj || 'pickup_zones' in obj || 'is_active' in obj || 'name' in obj;
}

/**
 * Checks whether a user can view / consult a depot (v59 §2).
 * Accepts flexible calling orders:
 * - `(user, depot, departments?, allUsers?, projects?)`
 * - `(depot, user, allUsers?, departments?, projects?)`
 * - `(depotName: string, user, depots?, allUsers?, departments?, projects?)`
 */
export function canUserViewDepot(
  arg1: any,
  arg2: any,
  arg3?: any,
  arg4?: any,
  arg5?: any,
  arg6?: any
): boolean {
  const { depots, departments, allUsers, projects } = extractUsersDeptsProjects([arg3, arg4, arg5, arg6]);

  let user: User | null | undefined;
  let depot: Depot | null | undefined;
  let depotNameFallback = '';

  if (typeof arg1 === 'string') {
    depotNameFallback = arg1;
    user = arg2 as User | null | undefined;
    depot = findDepotByName(depots, arg1) || ({ id: arg1, name: arg1, type: 'FIXED' } as Depot);
  } else if (isDepotLikeObject(arg1) && (!arg2 || !isDepotLikeObject(arg2))) {
    depot = arg1;
    user = arg2 as User | null | undefined;
  } else {
    user = arg1 as User | null | undefined;
    depot = arg2 as Depot | null | undefined;
  }

  if (!user || !depot) return false;
  if (Number(user.id) === 0 || Number(user.role_id) === 0 || Number(user.role_id) === 1) return true;

  if (isDepotVehicleOrContainer(depot)) {
    // 1. Le responsable (chauffeur) et son binôme
    if (isUserVehicleHolderOrBinome(user, depot)) {
      return true;
    }
    // 2. Le responsable du département et ses suppléants
    if (isUserDeptManagerOrDeputyForDepot(user, depot, departments, allUsers)) {
      return true;
    }
    // 3. Les gestionnaires de projet (manager et suppléants) des projets rattachés au département du véhicule/conteneur
    if (isUserProjectManagerForDepotDepartment(user, depot, departments, projects, allUsers)) {
      return true;
    }
    // 4. Pour un conteneur, le conducteur de travaux (et suppléants) de son chantier
    if (depot.type === 'CONTAINER' && isUserProjectManagerOrDeputy(user, depot.project_number, projects)) {
      return true;
    }
    return false;
  }

  // Standard fixed depot
  return isUserAllowedForDepot(user as User, depot.name || depotNameFallback);
}

/**
 * Filters a list of depots to only those visible to `user` according to `canUserViewDepot`.
 */
export function filterVisibleDepotsForUser(
  depots: Depot[] | null | undefined,
  user: User | null | undefined,
  arg3?: Department[] | User[] | null,
  arg4?: User[] | Department[] | null,
  arg5?: Project[] | null
): Depot[] {
  if (!depots || depots.length === 0) return [];
  if (!user) return [];
  const { departments, allUsers, projects } = extractUsersDeptsProjects([arg3, arg4, arg5]);
  return depots.filter((d) => canUserViewDepot(user, d, departments, allUsers, projects));
}

/**
 * Formats a depot name for display in movements, audit, or lists.
 * Supports both:
 * - `formatDepotNameForDisplay(depotName, depots, user, departments?, allUsers?, projects?)`
 * - `formatDepotNameForDisplay(depotObj, allUsers?)`
 */
export function formatDepotNameForDisplay(
  depotOrName: string | Depot | null | undefined,
  depotsOrUsers?: Depot[] | User[] | null,
  user?: User | null,
  arg4?: Department[] | User[] | null,
  arg5?: User[] | Department[] | null,
  arg6?: Project[] | null
): string {
  if (depotOrName && typeof depotOrName === 'object') {
    const d = depotOrName as Depot;
    const baseName = (d.name || '').trim() || 'Dépôt Principal';
    if (d.type === 'VEHICLE') {
      const usersList = Array.isArray(depotsOrUsers) ? (depotsOrUsers as User[]) : [];
      const holderName =
        d.manager_name ||
        (d.manager_id != null
          ? usersList.find((u) => String(u.id) === String(d.manager_id))?.name
          : undefined);
      if (holderName && !baseName.toLowerCase().includes(holderName.toLowerCase())) {
        return `${baseName} (${holderName})`;
      }
    }
    return baseName;
  }

  const clean = (depotOrName || '').trim();
  if (!clean) return 'Dépôt Principal';
  const depots = Array.isArray(depotsOrUsers) ? (depotsOrUsers as Depot[]) : [];
  if (depots.length === 0 || !user) return clean;

  const { departments, allUsers, projects } = extractUsersDeptsProjects([arg4, arg5, arg6]);
  const matched = findDepotByName(depots, clean);
  if (matched && isDepotVehicleOrContainer(matched)) {
    if (!canUserViewDepot(user, matched, departments, allUsers, projects)) {
      return RESTRICTED_VEHICLE_LABEL;
    }
  }
  return clean;
}

export interface EligibleStockInParams {
  product?: Partial<Product> | null;
  stockLevels?: StockLevel[];
  depots?: Depot[];
  user?: User | null;
  hasGeneralStockInPerm: boolean;
  departments?: Department[];
  allUsers?: User[];
  projects?: Project[];
}

function normalizeEligibleStockInParams(
  arg1: any,
  arg2?: any,
  arg3?: any,
  arg4?: any,
  arg5?: any,
  arg6?: any,
  arg7?: any,
  arg8?: any
): EligibleStockInParams {
  if (
    arg1 &&
    typeof arg1 === 'object' &&
    ('hasGeneralStockInPerm' in arg1 || 'stockLevels' in arg1 || 'depots' in arg1 || 'user' in arg1)
  ) {
    return arg1 as EligibleStockInParams;
  }
  const { departments, allUsers, projects } = extractUsersDeptsProjects([arg6, arg7, arg8]);
  return {
    product: arg1 as Partial<Product> | null | undefined,
    stockLevels: Array.isArray(arg2) ? arg2 : [],
    depots: Array.isArray(arg3) ? arg3 : [],
    user: arg4 as User | null | undefined,
    hasGeneralStockInPerm: Boolean(arg5),
    departments,
    allUsers,
    projects,
  };
}

/**
 * Retourne la liste des dépôts éligibles pour une ENTRÉE de stock (v59 §4).
 * Supporte à la fois l'appel par objet `{ product, stockLevels, depots, user, hasGeneralStockInPerm, ... }`
 * et l'appel positionnel `(product, stockLevels, depots, user, hasGeneralStockInPerm, departments, users, projects)`.
 */
export function getEligibleStockInDepotsForProduct(
  params: EligibleStockInParams
): string[];
export function getEligibleStockInDepotsForProduct(
  product: Partial<Product> | null | undefined,
  stockLevels: StockLevel[] | undefined,
  depots: Depot[] | undefined,
  user: User | null | undefined,
  hasGeneralStockInPerm: boolean,
  departments?: Department[] | User[],
  allUsers?: User[] | Department[],
  projects?: Project[]
): Depot[];
export function getEligibleStockInDepotsForProduct(
  arg1: any,
  arg2?: any,
  arg3?: any,
  arg4?: any,
  arg5?: any,
  arg6?: any,
  arg7?: any,
  arg8?: any
): any[] {
  const isObjectCall =
    arg1 &&
    typeof arg1 === 'object' &&
    ('hasGeneralStockInPerm' in arg1 || 'stockLevels' in arg1 || 'depots' in arg1 || 'user' in arg1);

  const {
    product,
    stockLevels = [],
    depots = [],
    user,
    hasGeneralStockInPerm,
    departments = [],
    allUsers = [],
    projects = [],
  } = normalizeEligibleStockInParams(arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8);

  if (!user) return [];

  const candidateNames = new Set<string>();
  const pid = product?.id !== undefined && product?.id !== null ? String(product.id) : '';

  // 1. Dépôts où l'article a déjà un niveau de stock
  if (pid) {
    for (const sl of stockLevels) {
      if (String(sl.product_id) === pid && sl.depot_name && sl.depot_name.trim()) {
        candidateNames.add(sl.depot_name.trim());
      }
    }
  }
  if (product?.store_name && product.store_name.trim()) {
    candidateNames.add(product.store_name.trim());
  }

  // 2. Tous les dépôts actifs
  for (const d of depots) {
    if (d.is_active !== false && d.name && d.name.trim()) {
      candidateNames.add(d.name.trim());
    }
  }

  // Filtrer par canUserEnterStockInDepot + canUserViewDepot
  const allowedNames: string[] = [];
  for (const name of candidateNames) {
    const check = canUserEnterStockInDepot(
      user,
      name,
      depots,
      hasGeneralStockInPerm,
      'fr',
      departments,
      allUsers,
      projects
    );
    if (!check.allowed) continue;
    const depotObj = findDepotByName(depots, name);
    if (depotObj && !canUserViewDepot(user, depotObj, departments, allUsers, projects)) {
      continue;
    }
    allowedNames.push(name);
  }

  // Ordonner : d'abord le véhicule/conteneur de l'utilisateur s'il en a un, puis product.store_name, puis alphabétique
  const userVehicleNames = new Set(
    getUserVehicles(user, depots).map((v) => normalizeDepotString(v.name))
  );
  const prodStoreNorm = normalizeDepotString(product?.store_name);

  const sortedNames = allowedNames.sort((a, b) => {
    const aNorm = normalizeDepotString(a);
    const bNorm = normalizeDepotString(b);
    const aIsUserVeh = userVehicleNames.has(aNorm);
    const bIsUserVeh = userVehicleNames.has(bNorm);
    if (aIsUserVeh && !bIsUserVeh) return -1;
    if (!aIsUserVeh && bIsUserVeh) return 1;
    if (aNorm === prodStoreNorm && bNorm !== prodStoreNorm) return -1;
    if (aNorm !== prodStoreNorm && bNorm === prodStoreNorm) return 1;
    return a.localeCompare(b, 'fr', { sensitivity: 'base' });
  });

  if (isObjectCall) {
    return sortedNames;
  }

  return sortedNames.map(
    (name) => findDepotByName(depots, name) || ({ id: name, name, type: 'FIXED', is_active: true } as Depot)
  );
}

/**
 * Valeur par défaut du sélecteur « Dépôt à alimenter » lors d'une entrée de stock (v59 §4).
 */
export function getDefaultStockInDepotForProduct(params: EligibleStockInParams): string;
export function getDefaultStockInDepotForProduct(
  product: Partial<Product> | null | undefined,
  user: User | null | undefined,
  depots: Depot[] | undefined,
  stockLevels: StockLevel[] | undefined,
  hasGeneralStockInPerm: boolean,
  departments?: Department[],
  allUsers?: User[],
  projects?: Project[]
): string;
export function getDefaultStockInDepotForProduct(
  arg1: any,
  user?: any,
  depots?: any,
  stockLevels?: any,
  hasGeneralStockInPerm?: any,
  departments?: any,
  allUsers?: any,
  projects?: any
): string {
  // Appel par objet { product, user, depots, ... } ou appel positionnel (utilisé par le panier et AppContext)
  const isObjectCall =
    arg1 &&
    typeof arg1 === 'object' &&
    ('hasGeneralStockInPerm' in arg1 || 'stockLevels' in arg1 || 'depots' in arg1 || 'user' in arg1);
  const params: EligibleStockInParams = isObjectCall
    ? arg1
    : ({
        product: arg1,
        user,
        depots: depots || [],
        stockLevels: stockLevels || [],
        hasGeneralStockInPerm: Boolean(hasGeneralStockInPerm),
        departments: departments || [],
        allUsers: allUsers || [],
        projects: projects || [],
      } as EligibleStockInParams);
  const eligible = getEligibleStockInDepotsForProduct(params);
  const userVehicles = getUserVehicles(params.user, params.depots);
  if (userVehicles.length > 0) {
    const firstVeh = userVehicles.find((v) =>
      eligible.some((e) => normalizeDepotString(e) === normalizeDepotString(v.name))
    );
    if (firstVeh) return firstVeh.name;
  }
  const prodStore = (params.product?.store_name || '').trim();
  if (
    prodStore &&
    eligible.some((e) => normalizeDepotString(e) === normalizeDepotString(prodStore))
  ) {
    return prodStore;
  }
  return eligible[0] || prodStore || 'Dépôt Principal';
}

