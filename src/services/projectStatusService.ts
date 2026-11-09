import type { SupabaseClient } from '@supabase/supabase-js';
import type { Department, Depot, MaterialOrder, Project, ProjectStatus, User } from '../types';

export type ProjectFilterStatus = 'IN_PROGRESS' | 'CLOSED' | 'ALL';

export const PROJECT_CLOSED_ALERT_PREFIX = 'PROJECT_CLOSED';
export const PROJECT_CLOSED_CONTAINER_WARNING =
  'Projet terminé : pensez à rapatrier le matériel';

function sameId(a?: string | number | null, b?: string | number | null): boolean {
  if (a === undefined || a === null || b === undefined || b === null) return false;
  const sa = String(a).trim();
  const sb = String(b).trim();
  return sa.length > 0 && sa === sb;
}

export function normalizeProjectStatus(status?: string | null): ProjectStatus {
  const s = String(status || '').trim().toUpperCase();
  return s === 'CLOSED' ? 'CLOSED' : 'IN_PROGRESS';
}

export function isProjectClosed(project?: Partial<Project> | null): boolean {
  if (!project) return false;
  return normalizeProjectStatus(project.status) === 'CLOSED';
}

/**
 * Qui peut terminer / rouvrir un projet (v60 §9) :
 * - Administrateurs (rôles 0 et 1)
 * - Responsable du département (et ses suppléants)
 * - Gestionnaire du projet (et ses suppléants)
 * Les autres utilisateurs ne voient pas les boutons.
 */
export function canUserManageProjectStatus(
  userOrParams?:
    | Partial<User>
    | null
    | {
        user?: Partial<User> | null;
        project?: Partial<Project> | null;
        departments?: Department[];
      },
  maybeProject?: Partial<Project> | null,
  maybeDepartments?: Department[]
): boolean {
  const isParamsObj =
    userOrParams !== null &&
    typeof userOrParams === 'object' &&
    ('user' in userOrParams || 'project' in userOrParams || 'departments' in userOrParams) &&
    maybeProject === undefined;

  const user = isParamsObj
    ? (userOrParams as { user?: Partial<User> | null }).user
    : (userOrParams as Partial<User> | null | undefined);
  const project = isParamsObj
    ? (userOrParams as { project?: Partial<Project> | null }).project
    : maybeProject;
  const departments =
    (isParamsObj
      ? (userOrParams as { departments?: Department[] }).departments
      : maybeDepartments) || [];

  if (!user || user.id === undefined || user.id === null) return false;

  const roleIdNum = Number(user.role_id);
  if (roleIdNum === 0 || roleIdNum === 1 || Number(user.id) === 0) {
    return true;
  }

  if (!project) return false;

  // Gestionnaire du projet ou suppléants
  if (sameId(project.manager_id, user.id)) {
    return true;
  }
  if (
    Array.isArray(project.deputy_manager_ids) &&
    project.deputy_manager_ids.some((id) => sameId(id, user.id))
  ) {
    return true;
  }

  // Responsable du département rattaché ou suppléants
  const dept = departments.find((d) => Number(d.id) === Number(project.department_id));
  if (dept) {
    if (sameId(dept.manager_id, user.id)) {
      return true;
    }
    if (
      Array.isArray(dept.deputy_manager_ids) &&
      dept.deputy_manager_ids.some((id) => sameId(id, user.id))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Retourne les commandes non finales (WAITING_APPROVAL, PENDING, PREPARING, READY)
 * rattachées à un numéro de projet / chantier donné.
 */
export function getNonFinalOrdersForProject(
  firstArg: string | MaterialOrder[] | null | undefined,
  secondArg: MaterialOrder[] | string | null | undefined = []
): MaterialOrder[] {
  const orders: MaterialOrder[] = Array.isArray(firstArg)
    ? firstArg
    : Array.isArray(secondArg)
    ? secondArg
    : [];
  const projectNumber = Array.isArray(firstArg)
    ? (secondArg as string | null | undefined)
    : (firstArg as string | null | undefined);

  const cleanNum = String(projectNumber || '').trim().toUpperCase();
  if (!cleanNum) return [];
  const nonFinalStatuses = new Set(['WAITING_APPROVAL', 'PENDING', 'PREPARING', 'READY']);
  return (orders || []).filter((o) => {
    if (!o || !nonFinalStatuses.has(o.status)) return false;
    return String(o.site_number || '').trim().toUpperCase() === cleanNum;
  });
}

/**
 * Filtre la liste des projets selon le contexte d'utilisation :
 * - 'OUT' | 'ORDER' | 'CONTAINER' : uniquement les projets IN_PROGRESS (sorties, commandes, paniers, scanner, transferts, conteneurs)
 * - 'IN' : tous les projets (les projets terminés restent sélectionnables pour un retour en stock)
 * - 'REPORT' : tous les projets si includeClosed est true (par défaut true dans les rapports), sinon uniquement IN_PROGRESS
 */
export function filterProjectsForSelection(
  projects: Project[] = [],
  mode: 'OUT' | 'ORDER' | 'CONTAINER' | 'IN' | 'REPORT' | 'ALL' = 'ORDER',
  includeClosed: boolean = mode === 'REPORT' || mode === 'IN' || mode === 'ALL'
): Project[] {
  const list = Array.isArray(projects) ? projects : [];
  if (mode === 'OUT' || mode === 'ORDER' || mode === 'CONTAINER') {
    return list.filter((p) => !isProjectClosed(p));
  }
  if (mode === 'IN') {
    return list;
  }
  if (!includeClosed) {
    return list.filter((p) => !isProjectClosed(p));
  }
  return list;
}

export function filterProjectsByStatusTab(
  projects: Project[] = [],
  tab: ProjectFilterStatus = 'IN_PROGRESS'
): Project[] {
  const list = Array.isArray(projects) ? projects : [];
  if (tab === 'ALL') return list;
  if (tab === 'CLOSED') return list.filter((p) => isProjectClosed(p));
  return list.filter((p) => !isProjectClosed(p));
}

export function formatProjectOptionLabel(
  project: Partial<Project>,
  mode: 'OUT' | 'ORDER' | 'CONTAINER' | 'IN' | 'REPORT' = 'ORDER',
  lang: 'fr' | 'en' | 'nl' = 'fr'
): string {
  const base = `${project.project_number || ''} — ${project.project_name || ''}`.trim();
  if (!isProjectClosed(project)) {
    return base;
  }
  if (mode === 'IN') {
    const suffix =
      lang === 'en'
        ? 'Project closed — return only'
        : lang === 'nl'
        ? 'Project afgesloten — enkel retour'
        : 'Projet terminé — retour uniquement';
    return `${base} (${suffix})`;
  }
  const closedTag =
    lang === 'en' ? 'Closed' : lang === 'nl' ? 'Afgesloten' : 'Terminé';
  return `${base} (${closedTag})`;
}

export function formatClosedProjectBadgeText(
  project: Partial<Project> | null | undefined,
  lang: 'fr' | 'en' | 'nl' = 'fr'
): string {
  if (!project || !isProjectClosed(project)) return '';
  const rawDate = project.closed_at;
  let formattedDate = '';
  if (rawDate) {
    const d = new Date(rawDate);
    if (!Number.isNaN(d.getTime())) {
      const locale = lang === 'en' ? 'en-GB' : lang === 'nl' ? 'nl-NL' : 'fr-FR';
      formattedDate = d.toLocaleDateString(locale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } else {
      formattedDate = String(rawDate);
    }
  }
  const byName = (project.closed_by_name || '').trim();
  if (lang === 'en') {
    return `Closed${formattedDate ? ` on ${formattedDate}` : ''}${byName ? ` by ${byName}` : ''}`;
  }
  if (lang === 'nl') {
    return `Afgesloten${formattedDate ? ` op ${formattedDate}` : ''}${byName ? ` door ${byName}` : ''}`;
  }
  return `Terminé${formattedDate ? ` le ${formattedDate}` : ''}${byName ? ` par ${byName}` : ''}`;
}

/**
 * Vérifie si un numéro de chantier saisi ou scanné est autorisé pour une SORTIE ou une COMMANDE.
 * Si le projet existe et a le statut `CLOSED`, retourne `{ allowed: false, valid: false, message: "Le projet X est terminé : sortie impossible" }`.
 */
export function validateProjectForOutflowOrOrder(
  firstArg: string | Project[] | null | undefined,
  secondArg: Project[] | string | null | undefined = [],
  lang: 'fr' | 'en' | 'nl' = 'fr'
): { allowed: boolean; valid: boolean; message?: string; errorMessage?: string; project?: Project } {
  const projects: Project[] = Array.isArray(firstArg)
    ? firstArg
    : Array.isArray(secondArg)
    ? secondArg
    : [];
  const projectNumber = Array.isArray(firstArg)
    ? (secondArg as string | null | undefined)
    : (firstArg as string | null | undefined);

  const cleanNum = String(projectNumber || '').trim();
  if (!cleanNum) return { allowed: true, valid: true };

  const matched = (projects || []).find(
    (p) => String(p.project_number || '').trim().toUpperCase() === cleanNum.toUpperCase()
  );
  if (matched && isProjectClosed(matched)) {
    const msg =
      lang === 'en'
        ? `Project ${matched.project_number} is closed: outflow impossible`
        : lang === 'nl'
        ? `Project ${matched.project_number} is afgesloten: uitgifte onmogelijk`
        : `Le projet ${matched.project_number} est terminé : sortie impossible`;
    return {
      allowed: false,
      valid: false,
      message: msg,
      errorMessage: msg,
      project: matched,
    };
  }
  return { allowed: true, valid: true, project: matched };
}

export interface ProjectStatusRpcResult {
  success: boolean;
  message: string;
  error?: string;
  code?: string;
  project?: Partial<Project>;
  blockingOrders?: MaterialOrder[];
}

/**
 * Appelle la RPC `close_project(p_project_number, p_note)`.
 * Ne fait JAMAIS `update core_projects set status=...` directement.
 */
export async function closeProjectViaRpc(
  clientOrParams:
    | SupabaseClient
    | null
    | {
        client: SupabaseClient | null;
        projectNumber: string;
        note?: string | null;
        orders?: MaterialOrder[];
        currentUser?: Partial<User> | null;
      },
  maybeProjectNumber?: string,
  maybeNote?: string | null,
  maybeOrdersOrUser?: MaterialOrder[] | Partial<User> | null,
  maybeCurrentUser?: Partial<User> | null
): Promise<ProjectStatusRpcResult> {
  const isParamsObj =
    clientOrParams !== null &&
    typeof clientOrParams === 'object' &&
    'projectNumber' in clientOrParams &&
    maybeProjectNumber === undefined;

  const client = isParamsObj
    ? (clientOrParams as { client: SupabaseClient | null }).client
    : (clientOrParams as SupabaseClient | null);
  const projectNumber = isParamsObj
    ? (clientOrParams as { projectNumber: string }).projectNumber
    : (maybeProjectNumber || '');
  const note = isParamsObj
    ? (clientOrParams as { note?: string | null }).note
    : maybeNote;
  const orders = isParamsObj
    ? (clientOrParams as { orders?: MaterialOrder[] }).orders || []
    : Array.isArray(maybeOrdersOrUser)
    ? maybeOrdersOrUser
    : [];
  const currentUser = isParamsObj
    ? (clientOrParams as { currentUser?: Partial<User> | null }).currentUser
    : Array.isArray(maybeOrdersOrUser)
    ? maybeCurrentUser
    : (maybeOrdersOrUser as Partial<User> | null | undefined) ?? maybeCurrentUser;

  const cleanNum = String(projectNumber || '').trim();
  if (!cleanNum) {
    return { success: false, message: 'Numéro de projet requis.', error: 'Numéro de projet requis.' };
  }

  const blocking = getNonFinalOrdersForProject(cleanNum, orders);

  if (client && typeof client.rpc === 'function') {
    try {
      const { data, error } = await client.rpc('close_project', {
        p_project_number: cleanNum,
        p_note: note && note.trim() ? note.trim() : null,
      });

      if (error) {
        const errMsg = error.message || 'Impossible de terminer le projet.';
        return {
          success: false,
          message: errMsg,
          error: errMsg,
          code: error.code ? String(error.code) : undefined,
          blockingOrders: blocking,
        };
      }

      if (data && typeof data === 'object' && (data as any).success === false) {
        const errMsg = String((data as any).message || (data as any).error || 'Impossible de terminer le projet.');
        return {
          success: false,
          message: errMsg,
          error: errMsg,
          code: (data as any).code ? String((data as any).code) : undefined,
          blockingOrders: blocking,
        };
      }

      const nowIso = new Date().toISOString();
      return {
        success: true,
        message: `Projet ${cleanNum} marqué comme terminé.`,
        project: {
          project_number: cleanNum,
          status: 'CLOSED',
          closed_at: (data as any)?.closed_at || nowIso,
          closed_by: (data as any)?.closed_by || currentUser?.id || null,
          closed_by_name: (data as any)?.closed_by_name || currentUser?.name || null,
          close_note: note && note.trim() ? note.trim() : null,
        },
      };
    } catch (err: any) {
      const errMsg = err?.message || 'Erreur lors de la clôture du projet.';
      return {
        success: false,
        message: errMsg,
        error: errMsg,
        code: err?.code ? String(err.code) : undefined,
        blockingOrders: blocking,
      };
    }
  }

  // Mode démo hors-ligne uniquement si aucun client Supabase n'est configuré
  if (blocking.length > 0) {
    const nums = blocking.map((o) => o.order_number).join(', ');
    const errMsg = `Impossible de terminer le projet ${cleanNum} : ${blocking.length} commande(s) non finale(s) en cours (${nums}).`;
    return {
      success: false,
      code: '23514',
      message: errMsg,
      error: errMsg,
      blockingOrders: blocking,
    };
  }

  const nowIso = new Date().toISOString();
  return {
    success: true,
    message: `Projet ${cleanNum} marqué comme terminé.`,
    project: {
      project_number: cleanNum,
      status: 'CLOSED',
      closed_at: nowIso,
      closed_by: currentUser?.id || null,
      closed_by_name: currentUser?.name || null,
      close_note: note && note.trim() ? note.trim() : null,
    },
  };
}

/**
 * Appelle la RPC `reopen_project(p_project_number, p_note)`.
 * Ne fait JAMAIS `update core_projects set status=...` directement.
 */
export async function reopenProjectViaRpc(
  clientOrParams:
    | SupabaseClient
    | null
    | {
        client: SupabaseClient | null;
        projectNumber: string;
        note?: string | null;
      },
  maybeProjectNumber?: string,
  maybeNote?: string | null,
  _maybeUser?: Partial<User> | null
): Promise<ProjectStatusRpcResult> {
  const isParamsObj =
    clientOrParams !== null &&
    typeof clientOrParams === 'object' &&
    'projectNumber' in clientOrParams &&
    maybeProjectNumber === undefined;

  const client = isParamsObj
    ? (clientOrParams as { client: SupabaseClient | null }).client
    : (clientOrParams as SupabaseClient | null);
  const projectNumber = isParamsObj
    ? (clientOrParams as { projectNumber: string }).projectNumber
    : (maybeProjectNumber || '');
  const note = isParamsObj
    ? (clientOrParams as { note?: string | null }).note
    : maybeNote;

  const cleanNum = String(projectNumber || '').trim();
  if (!cleanNum) {
    return { success: false, message: 'Numéro de projet requis.', error: 'Numéro de projet requis.' };
  }

  if (client && typeof client.rpc === 'function') {
    try {
      const { data, error } = await client.rpc('reopen_project', {
        p_project_number: cleanNum,
        p_note: note && note.trim() ? note.trim() : null,
      });

      if (error) {
        const errMsg = error.message || 'Impossible de rouvrir le projet.';
        return {
          success: false,
          message: errMsg,
          error: errMsg,
          code: error.code ? String(error.code) : undefined,
        };
      }

      if (data && typeof data === 'object' && (data as any).success === false) {
        const errMsg = String((data as any).message || (data as any).error || 'Impossible de rouvrir le projet.');
        return {
          success: false,
          message: errMsg,
          error: errMsg,
          code: (data as any).code ? String((data as any).code) : undefined,
        };
      }

      return {
        success: true,
        message: `Projet ${cleanNum} rouvert (En cours).`,
        project: {
          project_number: cleanNum,
          status: 'IN_PROGRESS',
          closed_at: null,
          closed_by: null,
          closed_by_name: null,
          close_note: note && note.trim() ? note.trim() : null,
        },
      };
    } catch (err: any) {
      const errMsg = err?.message || 'Erreur lors de la réouverture du projet.';
      return {
        success: false,
        message: errMsg,
        error: errMsg,
        code: err?.code ? String(err.code) : undefined,
      };
    }
  }

  return {
    success: true,
    message: `Projet ${cleanNum} rouvert (En cours).`,
    project: {
      project_number: cleanNum,
      status: 'IN_PROGRESS',
      closed_at: null,
      closed_by: null,
      closed_by_name: null,
      close_note: note && note.trim() ? note.trim() : null,
    },
  };
}

export interface ClosedProjectDepotAlert {
  notifKey: string;
  project: Project;
  depots: Depot[];
  attachedDepots: Depot[];
  message: string;
}

/**
 * Retourne les alertes `PROJECT_CLOSED:<project_number>` pour les véhicules/conteneurs
 * rattachés à un projet terminé, destinées au responsable du département (et suppléants)
 * et au gestionnaire du projet (et suppléants).
 */
export function getClosedProjectContainerAlertsForUser(
  userOrParams?:
    | Partial<User>
    | null
    | {
        user?: Partial<User> | null;
        projects?: Project[];
        depots?: Depot[];
        departments?: Department[];
        dismissedKeys?: ReadonlySet<string>;
      },
  maybeProjects?: Project[],
  maybeDepots?: Depot[],
  maybeDepartments?: Department[],
  maybeDismissedKeys?: ReadonlySet<string>
): ClosedProjectDepotAlert[] {
  const isParamsObj =
    userOrParams !== null &&
    typeof userOrParams === 'object' &&
    ('user' in userOrParams || 'projects' in userOrParams || 'depots' in userOrParams) &&
    maybeProjects === undefined;

  const user = isParamsObj
    ? (userOrParams as { user?: Partial<User> | null }).user
    : (userOrParams as Partial<User> | null | undefined);
  const projects =
    (isParamsObj ? (userOrParams as { projects?: Project[] }).projects : maybeProjects) || [];
  const depots =
    (isParamsObj ? (userOrParams as { depots?: Depot[] }).depots : maybeDepots) || [];
  const departments =
    (isParamsObj
      ? (userOrParams as { departments?: Department[] }).departments
      : maybeDepartments) || [];
  const dismissedKeys = isParamsObj
    ? (userOrParams as { dismissedKeys?: ReadonlySet<string> }).dismissedKeys
    : maybeDismissedKeys;

  if (!user || user.id === undefined || user.id === null) return [];

  const alerts: ClosedProjectDepotAlert[] = [];
  for (const project of projects) {
    if (!isProjectClosed(project) || !project.project_number) continue;

    const notifKey = `${PROJECT_CLOSED_ALERT_PREFIX}:${project.project_number}`;
    if (dismissedKeys && dismissedKeys.has(notifKey)) continue;

    // Vérifier s'il existe au moins un véhicule ou conteneur rattaché à ce projet
    const attachedDepots = depots.filter(
      (d) =>
        d.is_active !== false &&
        (d.type === 'CONTAINER' || d.type === 'VEHICLE') &&
        d.project_number &&
        d.project_number.trim().toUpperCase() === project.project_number.trim().toUpperCase()
    );
    if (attachedDepots.length === 0) continue;

    // Destinataires : responsable du département (et suppléants) et gestionnaire du projet (et suppléants)
    const isProjMgr =
      sameId(project.manager_id, user.id) ||
      (Array.isArray(project.deputy_manager_ids) &&
        project.deputy_manager_ids.some((id) => sameId(id, user.id)));

    const dept = departments.find((d) => Number(d.id) === Number(project.department_id));
    const isDeptMgr =
      dept &&
      (sameId(dept.manager_id, user.id) ||
        (Array.isArray(dept.deputy_manager_ids) &&
          dept.deputy_manager_ids.some((id) => sameId(id, user.id))));

    if (isProjMgr || isDeptMgr) {
      alerts.push({
        notifKey,
        project,
        depots: attachedDepots,
        attachedDepots,
        message: PROJECT_CLOSED_CONTAINER_WARNING,
      });
    }
  }

  return alerts;
}
